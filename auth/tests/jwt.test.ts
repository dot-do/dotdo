/**
 * JWT Verification Tests for @dotdo/auth
 *
 * Tests the core verifyJWT function using jose for:
 * - Signature validation
 * - Expiration checking
 * - Issuer/audience validation
 *
 * @module @dotdo/auth/tests/jwt
 */
import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'

describe('@dotdo/auth JWT verification', () => {
  const secret = new TextEncoder().encode('test-secret-key-min-32-chars!!')

  it('verifyJWT validates signature', async () => {
    const { verifyJWT } = await import('../jwt')

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret)

    const result = await verifyJWT(token, { secret })
    expect(result.sub).toBe('user-123')
  })

  it('verifyJWT rejects expired tokens', async () => {
    const { verifyJWT } = await import('../jwt')

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('-1h') // Already expired
      .sign(secret)

    await expect(verifyJWT(token, { secret })).rejects.toThrow()
  })

  it('verifyJWT rejects invalid signature', async () => {
    const { verifyJWT } = await import('../jwt')
    const wrongSecret = new TextEncoder().encode('wrong-secret-key-min-32-chars!!')

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(wrongSecret)

    await expect(verifyJWT(token, { secret })).rejects.toThrow()
  })

  it('verifyJWT validates issuer when specified', async () => {
    const { verifyJWT } = await import('../jwt')

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('id.org.ai')
      .setExpirationTime('1h')
      .sign(secret)

    // Should pass with correct issuer
    const result = await verifyJWT(token, { secret, issuer: 'id.org.ai' })
    expect(result.sub).toBe('user-123')

    // Should fail with wrong issuer
    await expect(verifyJWT(token, { secret, issuer: 'wrong.issuer' })).rejects.toThrow()
  })

  it('verifyJWT validates audience when specified', async () => {
    const { verifyJWT } = await import('../jwt')

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('dotdo.api')
      .setExpirationTime('1h')
      .sign(secret)

    // Should pass with correct audience
    const result = await verifyJWT(token, { secret, audience: 'dotdo.api' })
    expect(result.sub).toBe('user-123')

    // Should fail with wrong audience
    await expect(verifyJWT(token, { secret, audience: 'wrong.api' })).rejects.toThrow()
  })

  it('verifyJWT extracts all standard claims', async () => {
    const { verifyJWT } = await import('../jwt')

    const issuedAt = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      sub: 'user-123',
      email: 'test@example.com',
      roles: ['admin', 'user']
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('id.org.ai')
      .setAudience('dotdo.api')
      .setIssuedAt(issuedAt)
      .setExpirationTime('1h')
      .sign(secret)

    const result = await verifyJWT(token, { secret })

    expect(result.sub).toBe('user-123')
    expect(result.iss).toBe('id.org.ai')
    expect(result.aud).toBe('dotdo.api')
    expect(result.iat).toBe(issuedAt)
    expect(result.exp).toBeGreaterThan(issuedAt)
    // Custom claims
    expect(result['email']).toBe('test@example.com')
    expect(result['roles']).toEqual(['admin', 'user'])
  })

  it('verifyJWT accepts string secret', async () => {
    const { verifyJWT } = await import('../jwt')

    const stringSecret = 'test-secret-key-min-32-chars!!'
    const secretKey = new TextEncoder().encode(stringSecret)

    const token = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secretKey)

    // Should work with string secret
    const result = await verifyJWT(token, { secret: stringSecret })
    expect(result.sub).toBe('user-123')
  })

  it('verifyJWT rejects malformed tokens', async () => {
    const { verifyJWT } = await import('../jwt')

    await expect(verifyJWT('not.a.jwt', { secret })).rejects.toThrow()
    await expect(verifyJWT('', { secret })).rejects.toThrow()
    await expect(verifyJWT('invalid', { secret })).rejects.toThrow()
  })
})

describe('@dotdo/auth JWT middleware', () => {
  const secret = new TextEncoder().encode('test-secret-key-min-32-chars!!')

  it('createJWTMiddleware validates tokens', async () => {
    const { createJWTMiddleware } = await import('../jwt')
    const { Hono } = await import('hono')
    const { SignJWT } = await import('jose')

    const app = new Hono()
    app.use('/*', createJWTMiddleware({ secret }))
    app.get('/protected', (c) => c.json({ user: c.get('user') }))

    const token = await new SignJWT({ sub: 'user-123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret)

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` }
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.user.id).toBe('user-123')
    expect(json.user.email).toBe('test@example.com')
  })

  it('createJWTMiddleware rejects missing tokens', async () => {
    const { createJWTMiddleware } = await import('../jwt')
    const { Hono } = await import('hono')

    const app = new Hono()
    app.use('/*', createJWTMiddleware({ secret }))
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  it('createJWTMiddleware skips specified paths', async () => {
    const { createJWTMiddleware } = await import('../jwt')
    const { Hono } = await import('hono')

    const app = new Hono()
    app.use('/*', createJWTMiddleware({ secret, skipPaths: ['/public', '/health'] }))
    app.get('/public/info', (c) => c.json({ ok: true }))
    app.get('/health', (c) => c.json({ status: 'healthy' }))

    const res1 = await app.request('/public/info')
    expect(res1.status).toBe(200)

    const res2 = await app.request('/health')
    expect(res2.status).toBe(200)
  })
})
