import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { apiKeyMiddleware } from '../middleware'
import { ApiKeyManager, ApiKeyAuth } from '../apikey'

describe('API Key Validation in Middleware', () => {
  let app: Hono
  let manager: ApiKeyManager

  beforeEach(() => {
    app = new Hono()
    manager = new ApiKeyManager()
  })

  describe('apiKeyMiddleware with validation', () => {
    it('should reject requests without API key header', async () => {
      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      const res = await app.request('/api')
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toContain('X-API-Key')
    })

    it('should reject invalid API keys', async () => {
      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': 'invalid_key_12345678901234567890' }
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toBe('Invalid API key')
    })

    it('should reject malformed API keys', async () => {
      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': 'not-a-valid-format' }
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toBe('Invalid API key format')
    })

    it('should accept valid API keys and set user context', async () => {
      const { key, apiKey } = await manager.create({
        name: 'Test Key',
        scopes: ['api:read', 'api:write']
      })

      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ user: c.get('user'), apiKey: c.get('apiKey') }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(200)
      const json = await res.json() as {
        user: { id: string; roles: string[]; scopes: string[] }
        apiKey: { id: string; name: string }
      }
      expect(json.user.id).toBe(`apikey:${apiKey.id}`)
      expect(json.user.roles).toContain('api')
      expect(json.user.scopes).toEqual(['api:read', 'api:write'])
      expect(json.apiKey.id).toBe(apiKey.id)
      expect(json.apiKey.name).toBe('Test Key')
    })

    it('should reject revoked API keys', async () => {
      const { key, apiKey } = await manager.create({ name: 'Revoked Key' })
      await manager.revoke(apiKey.id)

      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toBe('API key revoked')
    })

    it('should reject expired API keys', async () => {
      const { key } = await manager.create({
        name: 'Expired Key',
        expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
      })

      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toBe('API key expired')
    })

    it('should support custom header name', async () => {
      const { key } = await manager.create({ name: 'Custom Header Key' })

      app.use('/*', apiKeyMiddleware({ manager, header: 'X-Custom-Key' }))
      app.get('/api', (c) => c.json({ ok: true }))

      // Should fail with default header
      const res1 = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })
      expect(res1.status).toBe(401)

      // Should succeed with custom header
      const res2 = await app.request('/api', {
        headers: { 'X-Custom-Key': key }
      })
      expect(res2.status).toBe(200)
    })

    it('should require scopes when specified', async () => {
      const { key: limitedKey } = await manager.create({
        name: 'Limited Key',
        scopes: ['users:read']
      })

      const { key: adminKey } = await manager.create({
        name: 'Admin Key',
        scopes: ['*']
      })

      app.use('/*', apiKeyMiddleware({ manager, requireScopes: ['admin:write'] }))
      app.get('/api', (c) => c.json({ ok: true }))

      // Limited key should be rejected - doesn't have required scope
      const res1 = await app.request('/api', {
        headers: { 'X-API-Key': limitedKey }
      })
      expect(res1.status).toBe(403)
      const text1 = await res1.text()
      expect(text1).toContain('Required scope')

      // Admin key should be accepted - has wildcard scope
      const res2 = await app.request('/api', {
        headers: { 'X-API-Key': adminKey }
      })
      expect(res2.status).toBe(200)
    })

    it('should enforce rate limits', async () => {
      const { key, apiKey } = await manager.create({
        name: 'Rate Limited Key',
        rateLimit: { maxRequests: 2, windowMs: 60000 }
      })

      app.use('/*', apiKeyMiddleware({ manager }))
      app.get('/api', (c) => c.json({ ok: true }))

      // First two requests should succeed
      const res1 = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })
      expect(res2.status).toBe(200)

      // Third request should be rate limited
      const res3 = await app.request('/api', {
        headers: { 'X-API-Key': key }
      })
      expect(res3.status).toBe(429)
      const text3 = await res3.text()
      expect(text3).toBe('Rate limit exceeded')
    })

    it('should throw error if manager is not provided', () => {
      expect(() => {
        apiKeyMiddleware({})
      }).toThrow('ApiKeyManager is required')
    })

    it('should work with skipValidation for backward compatibility', async () => {
      // When skipValidation is true, any key should work (legacy behavior)
      app.use('/*', apiKeyMiddleware({ skipValidation: true }))
      app.get('/api', (c) => c.json({ user: c.get('user') }))

      const res = await app.request('/api', {
        headers: { 'X-API-Key': 'any-key-works-here' }
      })

      expect(res.status).toBe(200)
      const json = await res.json() as { user: { id: string } }
      expect(json.user.id).toBe('apikey:any-key-')
    })
  })
})
