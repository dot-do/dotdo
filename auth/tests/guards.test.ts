import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireAuth, requireRole, requireScope, requireOwner, requireAll, requireAny } from '../guards'

// Helper to set user on context
const setUser = (user: any) => async (c: any, next: any) => {
  c.set('user', user)
  return next()
}

describe('Permission Guards', () => {
  describe('requireAuth', () => {
    it('should pass when user is set', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1' }))
      app.use('/*', requireAuth())
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when no user', async () => {
      const app = new Hono()
      app.use('/*', requireAuth())
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(401)
    })
  })

  describe('requireRole', () => {
    it('should pass with required role', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['admin'] }))
      app.use('/*', requireRole('admin'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject without required role', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['user'] }))
      app.use('/*', requireRole('admin'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should accept any of multiple roles', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['moderator'] }))
      app.use('/*', requireRole('admin', 'moderator'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when user has no roles', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1' }))
      app.use('/*', requireRole('admin'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should reject when not authenticated', async () => {
      const app = new Hono()
      app.use('/*', requireRole('admin'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(401)
    })
  })

  describe('requireScope', () => {
    it('should pass with exact scope', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', scopes: ['users:read'] }))
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should pass with wildcard scope', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', scopes: ['users:*'] }))
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should pass with global wildcard scope', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', scopes: ['*'] }))
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject without scope', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', scopes: ['orders:read'] }))
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should accept any of multiple scopes', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', scopes: ['users:write'] }))
      app.use('/*', requireScope('users:read', 'users:write'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when user has no scopes', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1' }))
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should reject when not authenticated', async () => {
      const app = new Hono()
      app.use('/*', requireScope('users:read'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(401)
    })
  })

  describe('requireOwner', () => {
    it('should pass when user is owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-123', roles: [] }))
      app.use('/*', requireOwner(() => 'user-123'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should pass for admin even if not owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'admin-1', roles: ['admin'] }))
      app.use('/*', requireOwner(() => 'user-123'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when not owner', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-456', roles: [] }))
      app.use('/*', requireOwner(() => 'user-123'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should reject when not authenticated', async () => {
      const app = new Hono()
      app.use('/*', requireOwner(() => 'user-123'))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(401)
    })

    it('should support async owner id resolution', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-123', roles: [] }))
      app.use('/*', requireOwner(async () => {
        // Simulate async database lookup
        return Promise.resolve('user-123')
      }))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should have access to context for owner resolution', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: 'user-123', roles: [] }))
      app.use('/*', requireOwner((c) => {
        // Could use c.req.param('id') in real usage
        return 'user-123'
      }))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })
  })

  describe('requireAll', () => {
    it('should pass when all guards pass', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['admin'], scopes: ['users:read'] }))
      app.use('/*', requireAll(requireRole('admin'), requireScope('users:read')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when any guard fails', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['user'], scopes: ['users:read'] }))
      app.use('/*', requireAll(requireRole('admin'), requireScope('users:read')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should reject when first guard fails', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['admin'], scopes: [] }))
      app.use('/*', requireAll(requireScope('users:read'), requireRole('admin')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })
  })

  describe('requireAny', () => {
    it('should pass if any guard passes', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['user'] }))
      app.use('/*', requireAny(requireRole('admin'), requireRole('user')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should pass if first guard passes', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['admin'] }))
      app.use('/*', requireAny(requireRole('admin'), requireRole('user')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('should reject when all guards fail', async () => {
      const app = new Hono()
      app.use('/*', setUser({ id: '1', roles: ['guest'] }))
      app.use('/*', requireAny(requireRole('admin'), requireRole('user')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })

    it('should reject when not authenticated', async () => {
      const app = new Hono()
      app.use('/*', requireAny(requireRole('admin'), requireRole('user')))
      app.get('/', (c) => c.json({ ok: true }))

      const res = await app.request('/')
      expect(res.status).toBe(401)
    })
  })
})
