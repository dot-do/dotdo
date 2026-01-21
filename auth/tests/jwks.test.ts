import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { SignJWT, generateKeyPair, exportJWK, type JWK } from 'jose'
import {
  createJwksClient,
  fetchJwks,
  verifyTokenWithJwks,
  validateTokenWithJwks,
  type JwksClient,
  type JwksClientOptions,
  type JwksValidationOptions,
} from '../jwks'

describe('JWKS Support', () => {
  // Test key pairs
  let rsaKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey }
  let rsaJwk: JWK
  let ecKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey }
  let ecJwk: JWK

  const issuer = 'https://id.org.ai'
  const audience = 'dotdo.api'

  // Helper to create JWKS endpoint response factory
  // Returns a function that creates fresh Response objects to avoid body consumption issues
  function createJwksResponseFactory(keys: JWK[]): () => Response {
    return () =>
      new Response(JSON.stringify({ keys }), {
        headers: { 'Content-Type': 'application/json' },
      })
  }

  // Helper to create JWKS endpoint response (for single-use tests)
  function createJwksResponse(keys: JWK[]): Response {
    return new Response(JSON.stringify({ keys }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Helper to create valid JWT with RSA
  async function createRsaJwt(
    payload: Record<string, unknown>,
    options?: { kid?: string; exp?: number; iss?: string; aud?: string }
  ): Promise<string> {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: options?.kid ?? 'rsa-key-1' })
      .setIssuedAt()
      .setIssuer(options?.iss ?? issuer)
      .setAudience(options?.aud ?? audience)

    if (options?.exp !== undefined) {
      jwt.setExpirationTime(options.exp)
    } else {
      jwt.setExpirationTime('1h')
    }

    return jwt.sign(rsaKeyPair.privateKey)
  }

  // Helper to create valid JWT with EC
  async function createEcJwt(
    payload: Record<string, unknown>,
    options?: { kid?: string; exp?: number; iss?: string; aud?: string }
  ): Promise<string> {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', kid: options?.kid ?? 'ec-key-1' })
      .setIssuedAt()
      .setIssuer(options?.iss ?? issuer)
      .setAudience(options?.aud ?? audience)

    if (options?.exp !== undefined) {
      jwt.setExpirationTime(options.exp)
    } else {
      jwt.setExpirationTime('1h')
    }

    return jwt.sign(ecKeyPair.privateKey)
  }

  beforeEach(async () => {
    // Generate RSA key pair
    rsaKeyPair = await generateKeyPair('RS256')
    rsaJwk = await exportJWK(rsaKeyPair.publicKey)
    rsaJwk.kid = 'rsa-key-1'
    rsaJwk.use = 'sig'
    rsaJwk.alg = 'RS256'

    // Generate EC key pair
    ecKeyPair = await generateKeyPair('ES256')
    ecJwk = await exportJWK(ecKeyPair.publicKey)
    ecJwk.kid = 'ec-key-1'
    ecJwk.use = 'sig'
    ecJwk.alg = 'ES256'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchJwks', () => {
    it('should fetch JWKS from URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createJwksResponse([rsaJwk]))
      vi.stubGlobal('fetch', mockFetch)

      const jwks = await fetchJwks('https://id.org.ai/.well-known/jwks.json')

      expect(mockFetch).toHaveBeenCalledWith('https://id.org.ai/.well-known/jwks.json')
      expect(jwks.keys).toHaveLength(1)
      expect(jwks.keys[0].kid).toBe('rsa-key-1')
    })

    it('should throw on non-200 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchJwks('https://id.org.ai/.well-known/jwks.json')).rejects.toThrow(
        'Failed to fetch JWKS'
      )
    })

    it('should throw on invalid JSON', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('not json', {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchJwks('https://id.org.ai/.well-known/jwks.json')).rejects.toThrow()
    })

    it('should throw on missing keys array', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchJwks('https://id.org.ai/.well-known/jwks.json')).rejects.toThrow(
        'Invalid JWKS'
      )
    })
  })

  describe('createJwksClient', () => {
    it('should create client with default options', () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      expect(client).toBeDefined()
      expect(typeof client.getKey).toBe('function')
      expect(typeof client.clearCache).toBe('function')
    })

    it('should create client with custom TTL', () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 3600,
      })

      expect(client).toBeDefined()
    })
  })

  describe('JwksClient.getKey', () => {
    let client: JwksClient

    beforeEach(() => {
      const responseFactory = createJwksResponseFactory([rsaJwk, ecJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600, // 10 minutes
      })
    })

    it('should fetch and return key by kid', async () => {
      const key = await client.getKey('rsa-key-1')

      expect(key).toBeDefined()
      expect(key.type).toBe('public')
    })

    it('should return EC key by kid', async () => {
      const key = await client.getKey('ec-key-1')

      expect(key).toBeDefined()
      expect(key.type).toBe('public')
    })

    it('should throw for unknown kid', async () => {
      await expect(client.getKey('unknown-key')).rejects.toThrow(
        'Key with kid "unknown-key" not found'
      )
    })

    it('should cache JWKS and not refetch within TTL', async () => {
      const responseFactory = createJwksResponseFactory([rsaJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      const cachedClient = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600,
      })

      // First call fetches
      await cachedClient.getKey('rsa-key-1')
      // Second call should use cache
      await cachedClient.getKey('rsa-key-1')

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should refetch after cache expires', async () => {
      vi.useFakeTimers()

      const responseFactory = createJwksResponseFactory([rsaJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      const shortTtlClient = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 1, // 1 second TTL
      })

      // First call
      await shortTtlClient.getKey('rsa-key-1')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past TTL
      vi.advanceTimersByTime(2000)

      // Second call should refetch
      await shortTtlClient.getKey('rsa-key-1')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should clear cache when clearCache is called', async () => {
      const responseFactory = createJwksResponseFactory([rsaJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      const cachedClient = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600,
      })

      await cachedClient.getKey('rsa-key-1')
      cachedClient.clearCache()
      await cachedClient.getKey('rsa-key-1')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('Key rotation handling', () => {
    it('should refetch JWKS when kid not found (key rotation)', async () => {
      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First fetch returns only old key
          return Promise.resolve(createJwksResponse([rsaJwk]))
        } else {
          // Second fetch returns new key after rotation
          return Promise.resolve(createJwksResponse([{ ...rsaJwk, kid: 'new-key-1' }]))
        }
      })
      vi.stubGlobal('fetch', mockFetch)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600,
        refetchOnMissingKey: true,
      })

      // First call populates cache with old key
      await client.getKey('rsa-key-1')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // New key not in cache - should trigger refetch
      const newKey = await client.getKey('new-key-1')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(newKey).toBeDefined()
    })

    it('should throw if key still not found after refetch', async () => {
      const responseFactory = createJwksResponseFactory([rsaJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600,
        refetchOnMissingKey: true,
      })

      await expect(client.getKey('non-existent-key')).rejects.toThrow('not found')
    })

    it('should respect refetch cooldown', async () => {
      vi.useFakeTimers()

      const responseFactory = createJwksResponseFactory([rsaJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 600,
        refetchOnMissingKey: true,
        refetchCooldown: 10, // 10 seconds cooldown
      })

      // First attempt with missing key - fetches once initially
      await expect(client.getKey('missing-1')).rejects.toThrow()
      const callsAfterFirst = mockFetch.mock.calls.length

      // Immediate second attempt should not refetch (within cooldown)
      await expect(client.getKey('missing-2')).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(callsAfterFirst) // No additional fetch

      // After cooldown, should refetch
      vi.advanceTimersByTime(11000)
      await expect(client.getKey('missing-3')).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(callsAfterFirst + 1)

      vi.useRealTimers()
    })
  })

  describe('verifyTokenWithJwks', () => {
    let client: JwksClient

    beforeEach(() => {
      const responseFactory = createJwksResponseFactory([rsaJwk, ecJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })
    })

    it('should verify RS256 token', async () => {
      const token = await createRsaJwt({ sub: 'user-123', email: 'test@example.com' })

      const result = await verifyTokenWithJwks(token, client, {
        issuer,
        audience,
      })

      expect(result.sub).toBe('user-123')
      expect(result.email).toBe('test@example.com')
    })

    it('should verify ES256 token', async () => {
      const token = await createEcJwt({ sub: 'user-456', email: 'ec@example.com' })

      const result = await verifyTokenWithJwks(token, client, {
        issuer,
        audience,
      })

      expect(result.sub).toBe('user-456')
      expect(result.email).toBe('ec@example.com')
    })

    it('should reject token with unknown kid', async () => {
      // Create token with unknown kid
      const jwt = new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')

      const token = await jwt.sign(rsaKeyPair.privateKey)

      await expect(verifyTokenWithJwks(token, client, { issuer, audience })).rejects.toThrow(
        'not found'
      )
    })

    it('should reject expired token', async () => {
      const token = await createRsaJwt(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) - 60 }
      )

      await expect(verifyTokenWithJwks(token, client, { issuer, audience })).rejects.toThrow()
    })

    it('should reject token with wrong issuer', async () => {
      const token = await createRsaJwt({ sub: 'user-123' }, { iss: 'https://evil.com' })

      await expect(
        verifyTokenWithJwks(token, client, {
          issuer,
          audience,
        })
      ).rejects.toThrow('iss')
    })

    it('should reject token with wrong audience', async () => {
      const token = await createRsaJwt({ sub: 'user-123' }, { aud: 'wrong.api' })

      await expect(
        verifyTokenWithJwks(token, client, {
          issuer,
          audience,
        })
      ).rejects.toThrow('aud')
    })

    it('should reject malformed token', async () => {
      await expect(
        verifyTokenWithJwks('not.a.jwt', client, { issuer, audience })
      ).rejects.toThrow()
    })

    it('should reject token without kid', async () => {
      // Create token without kid
      const jwt = new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256' }) // No kid
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')

      const token = await jwt.sign(rsaKeyPair.privateKey)

      await expect(verifyTokenWithJwks(token, client, { issuer, audience })).rejects.toThrow(
        'kid'
      )
    })

    it('should support multiple audiences', async () => {
      const token = await createRsaJwt({ sub: 'user-123' })

      const result = await verifyTokenWithJwks(token, client, {
        issuer,
        audience: ['api.dotdo.dev', 'dotdo.api'],
      })

      expect(result.sub).toBe('user-123')
    })
  })

  describe('validateTokenWithJwks middleware', () => {
    let app: Hono
    let client: JwksClient

    beforeEach(() => {
      const responseFactory = createJwksResponseFactory([rsaJwk, ecJwk])
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(responseFactory()))
      vi.stubGlobal('fetch', mockFetch)

      client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      app = new Hono()
      app.use(
        '/*',
        validateTokenWithJwks({
          jwksClient: client,
          issuer,
          audience,
        })
      )
      app.get('/protected', (c) => c.json({ user: c.get('user'), token: c.get('token') }))
    })

    it('should reject requests without token', async () => {
      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      const wwwAuth = res.headers.get('WWW-Authenticate')
      expect(wwwAuth).toContain('Bearer')
    })

    it('should accept valid RS256 JWT', async () => {
      const token = await createRsaJwt({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['admin'],
      })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
      expect(json.user.email).toBe('test@example.com')
      expect(json.user.roles).toContain('admin')
    })

    it('should accept valid ES256 JWT', async () => {
      const token = await createEcJwt({
        sub: 'user-456',
        email: 'ec@example.com',
      })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-456')
      expect(json.user.email).toBe('ec@example.com')
    })

    it('should reject expired tokens', async () => {
      const token = await createRsaJwt(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) - 60 }
      )

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject token with wrong issuer', async () => {
      const token = await createRsaJwt({ sub: 'user-123' }, { iss: 'https://evil.com' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject token with wrong audience', async () => {
      const token = await createRsaJwt({ sub: 'user-123' }, { aud: 'wrong.api' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    it('should skip validation for excluded paths', async () => {
      const skipApp = new Hono()
      skipApp.use(
        '/*',
        validateTokenWithJwks({
          jwksClient: client,
          issuer,
          audience,
          skipPaths: ['/public', '/health'],
        })
      )
      skipApp.get('/public/info', (c) => c.json({ ok: true }))
      skipApp.get('/health', (c) => c.json({ status: 'ok' }))

      const res1 = await skipApp.request('/public/info')
      expect(res1.status).toBe(200)

      const res2 = await skipApp.request('/health')
      expect(res2.status).toBe(200)
    })

    it('should extract token from cookies when configured', async () => {
      const cookieApp = new Hono()
      cookieApp.use(
        '/*',
        validateTokenWithJwks({
          jwksClient: client,
          issuer,
          audience,
          cookieName: 'auth_token',
        })
      )
      cookieApp.get('/protected', (c) => c.json({ user: c.get('user') }))

      const token = await createRsaJwt({ sub: 'user-123' })

      const res = await cookieApp.request('/protected', {
        headers: { Cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
    })

    it('should set refresh hint header for tokens close to expiration', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 120 // 2 minutes
      const token = await createRsaJwt({ sub: 'user-123' }, { exp: expiresAt })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const refreshHint = res.headers.get('X-Token-Refresh-Hint')
      expect(refreshHint).toBe('true')
    })

    it('should handle token with all standard claims', async () => {
      const token = await createRsaJwt({
        sub: 'user-789',
        email: 'full@example.com',
        roles: ['admin', 'user'],
        scopes: ['read:users', 'write:users'],
      })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user).toEqual({
        id: 'user-789',
        email: 'full@example.com',
        roles: ['admin', 'user'],
        scopes: ['read:users', 'write:users'],
      })
    })

    it('should handle token without optional claims', async () => {
      const token = await createRsaJwt({ sub: 'user-minimal' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user).toEqual({
        id: 'user-minimal',
        email: undefined,
        roles: [],
        scopes: [],
      })
    })
  })

  describe('JWKS URL discovery', () => {
    it('should construct well-known URL from issuer', () => {
      // This is a common pattern - derive JWKS URL from issuer
      const issuerUrl = 'https://id.org.ai'
      const expectedJwksUrl = `${issuerUrl}/.well-known/jwks.json`

      // The implementation should support this pattern
      const client = createJwksClient({
        jwksUri: expectedJwksUrl,
      })

      expect(client).toBeDefined()
    })

    it('should handle issuer with trailing slash', () => {
      const issuerUrl = 'https://id.org.ai/'
      const expectedJwksUrl = 'https://id.org.ai/.well-known/jwks.json'

      // When constructing from issuer, trailing slashes should be handled
      const normalizedIssuer = issuerUrl.replace(/\/$/, '')
      const jwksUrl = `${normalizedIssuer}/.well-known/jwks.json`

      expect(jwksUrl).toBe(expectedJwksUrl)
    })
  })

  describe('Algorithm restrictions', () => {
    it('should reject HS256 tokens (symmetric) by default', async () => {
      // JWKS validation should only accept asymmetric algorithms
      const symmetricSecret = new TextEncoder().encode(
        'test-secret-key-minimum-256-bits-long-for-hs256'
      )

      const jwt = new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')

      const token = await jwt.sign(symmetricSecret)

      const mockFetch = vi.fn().mockResolvedValue(createJwksResponse([rsaJwk]))
      vi.stubGlobal('fetch', mockFetch)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Should reject because HS256 doesn't use public keys from JWKS
      await expect(verifyTokenWithJwks(token, client, { issuer, audience })).rejects.toThrow()
    })
  })

  describe('Error handling', () => {
    it('should provide meaningful error for network failures', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchJwks('https://id.org.ai/.well-known/jwks.json')).rejects.toThrow(
        'Network error'
      )
    })

    it('should provide meaningful error for invalid key format', async () => {
      const invalidJwk = { kty: 'invalid', kid: 'bad-key' }
      const mockFetch = vi
        .fn()
        .mockResolvedValue(createJwksResponse([invalidJwk as unknown as JWK]))
      vi.stubGlobal('fetch', mockFetch)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      await expect(client.getKey('bad-key')).rejects.toThrow()
    })
  })
})
