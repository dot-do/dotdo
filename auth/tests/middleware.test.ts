import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware, apiKeyMiddleware } from '../middleware'

describe('Auth Middleware', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
  })

  describe('authMiddleware', () => {
    beforeEach(() => {
      app.use('/*', authMiddleware())
      app.get('/protected', (c) => c.json({ user: c.get('user') }))
    })

    it('should reject requests without Authorization header', async () => {
      const res = await app.request('/protected')
      expect(res.status).toBe(401)
    })

    it('should reject non-Bearer tokens', async () => {
      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic abc123' }
      })
      expect(res.status).toBe(401)
    })

    it('should accept valid Bearer token', async () => {
      const payload = { sub: 'user-123', email: 'test@example.com', roles: ['admin'] }
      const token = btoa(JSON.stringify(payload))

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
      expect(json.user.email).toBe('test@example.com')
      expect(json.user.roles).toContain('admin')
    })

    it('should skip auth for specified paths', async () => {
      const skipApp = new Hono()
      skipApp.use('/*', authMiddleware({ skipPaths: ['/public', '/health'] }))
      skipApp.get('/public/data', (c) => c.json({ ok: true }))
      skipApp.get('/health', (c) => c.json({ status: 'ok' }))

      const res1 = await skipApp.request('/public/data')
      expect(res1.status).toBe(200)

      const res2 = await skipApp.request('/health')
      expect(res2.status).toBe(200)
    })
  })

  describe('apiKeyMiddleware', () => {
    beforeEach(() => {
      app.use('/*', apiKeyMiddleware())
      app.get('/api', (c) => c.json({ user: c.get('user') }))
    })

    it('should reject requests without API key', async () => {
      const res = await app.request('/api')
      expect(res.status).toBe(401)
    })

    it('should accept valid API key', async () => {
      const res = await app.request('/api', {
        headers: { 'X-API-Key': 'my-secret-key-12345' }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('apikey:my-secre')
      expect(json.user.roles).toContain('api')
    })

    it('should support custom header name', async () => {
      const customApp = new Hono()
      customApp.use('/*', apiKeyMiddleware({ header: 'X-Custom-Key' }))
      customApp.get('/api', (c) => c.json({ ok: true }))

      const res = await customApp.request('/api', {
        headers: { 'X-Custom-Key': 'custom-key' }
      })

      expect(res.status).toBe(200)
    })
  })
})
