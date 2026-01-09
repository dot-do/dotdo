import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

import {
  visibilityMiddleware,
  requireVisibility,
  requireVisibilityLevel,
  extractActor,
  checkVisibility,
  canViewThing,
  filterByVisibility,
  getAccessibleVisibilities,
  assertVisibility,
  visibleOrNull,
  isAdmin,
  type VisibilityConfig,
  type VisibilityAuthContext,
  type SessionContext,
} from '../../middleware/visibility'

import type { ThingData, Actor, Visibility } from '../../../types/Thing'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock thing with visibility settings
 */
function createMockThing(options: {
  id?: string
  visibility?: Visibility
  ownerId?: string
  orgId?: string
}): ThingData {
  return {
    $id: options.id ?? 'test-thing-123',
    $type: 'TestThing',
    visibility: options.visibility ?? 'user',
    meta: {
      ownerId: options.ownerId,
      orgId: options.orgId,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Create a test Hono app with visibility middleware
 */
function createTestApp(config: VisibilityConfig = {}) {
  const app = new Hono<{
    Variables: {
      auth?: VisibilityAuthContext
      session?: SessionContext
      actor?: Actor
      isAdmin?: boolean
      thing?: ThingData
    }
  }>()

  // Apply visibility middleware
  app.use('*', visibilityMiddleware(config))

  return app
}

// ============================================================================
// Unit Tests: extractActor
// ============================================================================

describe('extractActor', () => {
  it('extracts userId from auth context', async () => {
    const app = new Hono<{ Variables: { auth: VisibilityAuthContext } }>()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'user-123' })
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.userId).toBe('user-123')
  })

  it('extracts orgId from auth context', async () => {
    const app = new Hono<{ Variables: { auth: VisibilityAuthContext } }>()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'user-123', orgId: 'org-456' })
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body).toEqual({
      userId: 'user-123',
      orgId: 'org-456',
    })
  })

  it('extracts userId from session context', async () => {
    const app = new Hono<{ Variables: { session: SessionContext } }>()

    app.get('/test', (c) => {
      c.set('session', { userId: 'session-user-123' })
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body).toEqual({
      userId: 'session-user-123',
    })
  })

  it('extracts activeOrganizationId from session as orgId', async () => {
    const app = new Hono<{ Variables: { session: SessionContext } }>()

    app.get('/test', (c) => {
      c.set('session', {
        userId: 'user-123',
        activeOrganizationId: 'org-from-session',
      })
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body).toEqual({
      userId: 'user-123',
      orgId: 'org-from-session',
    })
  })

  it('prefers auth context over session context', async () => {
    const app = new Hono<{
      Variables: { auth: VisibilityAuthContext; session: SessionContext }
    }>()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'auth-user', orgId: 'auth-org' })
      c.set('session', { userId: 'session-user', activeOrganizationId: 'session-org' })
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body).toEqual({
      userId: 'auth-user',
      orgId: 'auth-org',
    })
  })

  it('returns empty actor when no context is set', async () => {
    const app = new Hono()

    app.get('/test', (c) => {
      const actor = extractActor(c)
      return c.json(actor)
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body).toEqual({})
  })
})

// ============================================================================
// Unit Tests: isAdmin
// ============================================================================

describe('isAdmin', () => {
  it('returns true for admin role', async () => {
    const app = new Hono<{ Variables: { auth: VisibilityAuthContext } }>()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'admin-123', role: 'admin' })
      return c.json({ isAdmin: isAdmin(c) })
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body.isAdmin).toBe(true)
  })

  it('returns false for user role', async () => {
    const app = new Hono<{ Variables: { auth: VisibilityAuthContext } }>()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'user-123', role: 'user' })
      return c.json({ isAdmin: isAdmin(c) })
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body.isAdmin).toBe(false)
  })

  it('returns false when no auth context', async () => {
    const app = new Hono()

    app.get('/test', (c) => {
      return c.json({ isAdmin: isAdmin(c) })
    })

    const res = await app.request('/test')
    const body = await res.json()

    expect(body.isAdmin).toBe(false)
  })
})

// ============================================================================
// Unit Tests: checkVisibility
// ============================================================================

describe('checkVisibility', () => {
  describe('public visibility', () => {
    it('allows anonymous access to public things', () => {
      const thing = createMockThing({ visibility: 'public' })
      const actor: Actor = {}

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(true)
      expect(result.visibility).toBe('public')
    })

    it('allows authenticated access to public things', () => {
      const thing = createMockThing({ visibility: 'public' })
      const actor: Actor = { userId: 'user-123' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(true)
    })
  })

  describe('unlisted visibility', () => {
    it('allows anonymous access to unlisted things', () => {
      const thing = createMockThing({ visibility: 'unlisted' })
      const actor: Actor = {}

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(true)
      expect(result.visibility).toBe('unlisted')
    })
  })

  describe('org visibility', () => {
    it('allows access when actor is in the same org', () => {
      const thing = createMockThing({
        visibility: 'org',
        orgId: 'org-123',
      })
      const actor: Actor = { userId: 'user-456', orgId: 'org-123' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(true)
    })

    it('denies access when actor is in different org', () => {
      const thing = createMockThing({
        visibility: 'org',
        orgId: 'org-123',
      })
      const actor: Actor = { userId: 'user-456', orgId: 'other-org' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Organization membership required')
    })

    it('denies access when actor has no org', () => {
      const thing = createMockThing({
        visibility: 'org',
        orgId: 'org-123',
      })
      const actor: Actor = { userId: 'user-456' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
    })

    it('denies anonymous access to org things', () => {
      const thing = createMockThing({
        visibility: 'org',
        orgId: 'org-123',
      })
      const actor: Actor = {}

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
    })
  })

  describe('user visibility (private)', () => {
    it('allows access when actor is the owner', () => {
      const thing = createMockThing({
        visibility: 'user',
        ownerId: 'user-123',
      })
      const actor: Actor = { userId: 'user-123' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(true)
    })

    it('denies access when actor is not the owner', () => {
      const thing = createMockThing({
        visibility: 'user',
        ownerId: 'user-123',
      })
      const actor: Actor = { userId: 'other-user' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Owner access required')
    })

    it('denies anonymous access to user things', () => {
      const thing = createMockThing({
        visibility: 'user',
        ownerId: 'user-123',
      })
      const actor: Actor = {}

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
    })
  })

  describe('admin bypass', () => {
    it('allows admin to bypass visibility checks', () => {
      const thing = createMockThing({
        visibility: 'user',
        ownerId: 'user-123',
      })
      const actor: Actor = { userId: 'admin-456' }

      const result = checkVisibility(thing, actor, {
        adminBypass: true,
        isAdmin: true,
      })

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('Admin bypass')
    })

    it('does not bypass when adminBypass is false', () => {
      const thing = createMockThing({
        visibility: 'user',
        ownerId: 'user-123',
      })
      const actor: Actor = { userId: 'admin-456' }

      const result = checkVisibility(thing, actor, {
        adminBypass: false,
        isAdmin: true,
      })

      expect(result.allowed).toBe(false)
    })
  })

  describe('default visibility', () => {
    it('treats undefined visibility as user (private)', () => {
      const thing: ThingData = {
        $id: 'test-thing',
        $type: 'Test',
        // visibility is undefined
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'other-user' }

      const result = checkVisibility(thing, actor)

      expect(result.allowed).toBe(false)
      expect(result.visibility).toBe('user')
    })
  })
})

// ============================================================================
// Unit Tests: canViewThing
// ============================================================================

describe('canViewThing', () => {
  it('returns true for public things', () => {
    const thing = createMockThing({ visibility: 'public' })
    expect(canViewThing(thing, {})).toBe(true)
  })

  it('returns false for private things without matching owner', () => {
    const thing = createMockThing({
      visibility: 'user',
      ownerId: 'owner-123',
    })
    expect(canViewThing(thing, { userId: 'other-user' })).toBe(false)
  })

  it('returns true for private things with matching owner', () => {
    const thing = createMockThing({
      visibility: 'user',
      ownerId: 'owner-123',
    })
    expect(canViewThing(thing, { userId: 'owner-123' })).toBe(true)
  })
})

// ============================================================================
// Unit Tests: filterByVisibility
// ============================================================================

describe('filterByVisibility', () => {
  it('filters out things the actor cannot view', () => {
    const things = [
      createMockThing({ id: 'public', visibility: 'public' }),
      createMockThing({ id: 'private-owned', visibility: 'user', ownerId: 'user-123' }),
      createMockThing({ id: 'private-other', visibility: 'user', ownerId: 'other-user' }),
      createMockThing({ id: 'org-same', visibility: 'org', orgId: 'org-abc' }),
      createMockThing({ id: 'org-diff', visibility: 'org', orgId: 'org-xyz' }),
    ]

    const actor: Actor = { userId: 'user-123', orgId: 'org-abc' }
    const visible = filterByVisibility(things, actor)

    // Should see: public, private-owned (owner matches), org-same (org matches)
    // Should NOT see: private-other (owner doesn't match), org-diff (org doesn't match)
    expect(visible).toHaveLength(3)
    expect(visible.map((t) => t.$id)).toEqual([
      'public',
      'private-owned',
      'org-same',
    ])
  })

  it('returns all things for admin with bypass', () => {
    const things = [
      createMockThing({ id: 'public', visibility: 'public' }),
      createMockThing({ id: 'private', visibility: 'user', ownerId: 'other' }),
      createMockThing({ id: 'org', visibility: 'org', orgId: 'other-org' }),
    ]

    const actor: Actor = { userId: 'admin-123' }
    const visible = filterByVisibility(things, actor, {
      adminBypass: true,
      isAdmin: true,
    })

    expect(visible).toHaveLength(3)
  })

  it('returns empty array when no things are visible', () => {
    const things = [
      createMockThing({ id: 'private1', visibility: 'user', ownerId: 'owner-a' }),
      createMockThing({ id: 'private2', visibility: 'user', ownerId: 'owner-b' }),
    ]

    const actor: Actor = { userId: 'different-user' }
    const visible = filterByVisibility(things, actor)

    expect(visible).toHaveLength(0)
  })
})

// ============================================================================
// Unit Tests: getAccessibleVisibilities
// ============================================================================

describe('getAccessibleVisibilities', () => {
  it('returns public and unlisted for anonymous users', () => {
    const actor: Actor = {}
    const visibilities = getAccessibleVisibilities(actor)

    expect(visibilities).toContain('public')
    expect(visibilities).toContain('unlisted')
    expect(visibilities).not.toContain('org')
    expect(visibilities).not.toContain('user')
  })

  it('includes org for users with orgId', () => {
    const actor: Actor = { userId: 'user-123', orgId: 'org-456' }
    const visibilities = getAccessibleVisibilities(actor)

    expect(visibilities).toContain('public')
    expect(visibilities).toContain('unlisted')
    expect(visibilities).toContain('org')
    expect(visibilities).toContain('user')
  })

  it('includes user for authenticated users', () => {
    const actor: Actor = { userId: 'user-123' }
    const visibilities = getAccessibleVisibilities(actor)

    expect(visibilities).toContain('user')
  })

  it('returns all visibilities for admin with bypass', () => {
    const actor: Actor = { userId: 'admin-123' }
    const visibilities = getAccessibleVisibilities(actor, {
      adminBypass: true,
      isAdmin: true,
    })

    expect(visibilities).toEqual(['public', 'unlisted', 'org', 'user'])
  })
})

// ============================================================================
// Unit Tests: assertVisibility
// ============================================================================

describe('assertVisibility', () => {
  it('does not throw for visible things', () => {
    const thing = createMockThing({ visibility: 'public' })
    const actor: Actor = {}

    expect(() => assertVisibility(thing, actor)).not.toThrow()
  })

  it('throws for things the actor cannot view', () => {
    const thing = createMockThing({
      visibility: 'user',
      ownerId: 'other-user',
    })
    const actor: Actor = { userId: 'user-123' }

    expect(() => assertVisibility(thing, actor)).toThrow('Owner access required')
  })

  it('throws with org message for org visibility', () => {
    const thing = createMockThing({
      visibility: 'org',
      orgId: 'org-123',
    })
    const actor: Actor = { userId: 'user-123', orgId: 'different-org' }

    expect(() => assertVisibility(thing, actor)).toThrow('Organization membership required')
  })
})

// ============================================================================
// Unit Tests: visibleOrNull
// ============================================================================

describe('visibleOrNull', () => {
  it('returns the thing if visible', () => {
    const thing = createMockThing({ visibility: 'public' })
    const actor: Actor = {}

    const result = visibleOrNull(thing, actor)

    expect(result).toBe(thing)
  })

  it('returns null if not visible', () => {
    const thing = createMockThing({
      visibility: 'user',
      ownerId: 'other-user',
    })
    const actor: Actor = { userId: 'user-123' }

    const result = visibleOrNull(thing, actor)

    expect(result).toBeNull()
  })

  it('returns null if thing is null', () => {
    const result = visibleOrNull(null, { userId: 'user-123' })
    expect(result).toBeNull()
  })

  it('returns null if thing is undefined', () => {
    const result = visibleOrNull(undefined, { userId: 'user-123' })
    expect(result).toBeNull()
  })
})

// ============================================================================
// Integration Tests: visibilityMiddleware
// ============================================================================

describe('visibilityMiddleware', () => {
  it('sets actor on context', async () => {
    const app = createTestApp()

    app.get('/test', (c) => {
      c.set('auth', { userId: 'user-123', orgId: 'org-456' })
      const actor = c.get('actor')
      return c.json({ actor })
    })

    // Need to apply middleware first
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; actor: Actor }
    }>()
    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123', orgId: 'org-456' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get('/test', (c) => {
      return c.json({ actor: c.get('actor') })
    })

    const res = await fullApp.request('/test')
    const body = await res.json()

    expect(body.actor).toEqual({
      userId: 'user-123',
      orgId: 'org-456',
    })
  })

  it('sets isAdmin on context', async () => {
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; isAdmin: boolean }
    }>()
    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'admin-123', role: 'admin' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get('/test', (c) => {
      return c.json({ isAdmin: c.get('isAdmin') })
    })

    const res = await fullApp.request('/test')
    const body = await res.json()

    expect(body.isAdmin).toBe(true)
  })

  it('skips visibility processing for public paths', async () => {
    const fullApp = new Hono<{
      Variables: { actor: Actor }
    }>()
    fullApp.use('*', visibilityMiddleware({ publicPaths: ['/public'] }))
    fullApp.get('/public/resource', (c) => {
      // Actor should not be set for public paths
      const actor = c.get('actor')
      return c.json({ hasActor: actor !== undefined })
    })

    const res = await fullApp.request('/public/resource')
    const body = await res.json()

    // For public paths, actor is not set
    expect(body.hasActor).toBe(false)
  })
})

// ============================================================================
// Integration Tests: requireVisibility
// ============================================================================

describe('requireVisibility', () => {
  it('allows access when thing is visible', async () => {
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; thing: ThingData; actor: Actor }
    }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get(
      '/thing',
      async (c, next) => {
        c.set('thing', createMockThing({ visibility: 'public' }))
        return next()
      },
      requireVisibility(),
      (c) => c.json({ success: true })
    )

    const res = await fullApp.request('/thing')
    expect(res.status).toBe(200)
  })

  it('returns 403 when thing is not visible', async () => {
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; thing: ThingData; actor: Actor }
    }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get(
      '/thing',
      async (c, next) => {
        c.set(
          'thing',
          createMockThing({
            visibility: 'user',
            ownerId: 'different-user',
          })
        )
        return next()
      },
      requireVisibility(),
      (c) => c.json({ success: true })
    )

    const res = await fullApp.request('/thing')
    expect(res.status).toBe(403)
  })

  it('allows admin bypass', async () => {
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; thing: ThingData; actor: Actor; isAdmin: boolean }
    }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'admin-123', role: 'admin' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get(
      '/thing',
      async (c, next) => {
        c.set(
          'thing',
          createMockThing({
            visibility: 'user',
            ownerId: 'different-user',
          })
        )
        return next()
      },
      requireVisibility({ adminBypass: true }),
      (c) => c.json({ success: true })
    )

    const res = await fullApp.request('/thing')
    expect(res.status).toBe(200)
  })

  it('continues without check when no thing is set', async () => {
    const fullApp = new Hono<{ Variables: { auth: VisibilityAuthContext } }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get('/thing', requireVisibility(), (c) => c.json({ success: true }))

    const res = await fullApp.request('/thing')
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Integration Tests: requireVisibilityLevel
// ============================================================================

describe('requireVisibilityLevel', () => {
  it('allows access when actor can access required level', async () => {
    const fullApp = new Hono<{ Variables: { auth: VisibilityAuthContext; actor: Actor } }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123', orgId: 'org-456' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get('/org-only', requireVisibilityLevel('org'), (c) =>
      c.json({ success: true })
    )

    const res = await fullApp.request('/org-only')
    expect(res.status).toBe(200)
  })

  it('returns 403 when actor cannot access required level', async () => {
    const fullApp = new Hono<{ Variables: { auth: VisibilityAuthContext; actor: Actor } }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123' }) // No orgId
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get('/org-only', requireVisibilityLevel('org'), (c) =>
      c.json({ success: true })
    )

    const res = await fullApp.request('/org-only')
    expect(res.status).toBe(403)
  })

  it('allows any of multiple required levels', async () => {
    const fullApp = new Hono<{ Variables: { auth: VisibilityAuthContext; actor: Actor } }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-123' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get(
      '/test',
      requireVisibilityLevel(['public', 'user']),
      (c) => c.json({ success: true })
    )

    const res = await fullApp.request('/test')
    expect(res.status).toBe(200)
  })

  it('allows admin bypass', async () => {
    const fullApp = new Hono<{
      Variables: { auth: VisibilityAuthContext; actor: Actor; isAdmin: boolean }
    }>()

    fullApp.use('*', async (c, next) => {
      c.set('auth', { userId: 'admin-123', role: 'admin' })
      return next()
    })
    fullApp.use('*', visibilityMiddleware())
    fullApp.get(
      '/test',
      requireVisibilityLevel('org', { adminBypass: true }),
      (c) => c.json({ success: true })
    )

    const res = await fullApp.request('/test')
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles thing with no meta field', () => {
    const thing: ThingData = {
      $id: 'test',
      $type: 'Test',
      visibility: 'public',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(canViewThing(thing, {})).toBe(true)
  })

  it('handles empty actor object', () => {
    const thing = createMockThing({ visibility: 'public' })
    const result = checkVisibility(thing, {})

    expect(result.allowed).toBe(true)
  })

  it('handles null values in thing meta', () => {
    const thing: ThingData = {
      $id: 'test',
      $type: 'Test',
      visibility: 'org',
      meta: {
        orgId: null as unknown as string,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = checkVisibility(thing, { orgId: 'org-123' })
    expect(result.allowed).toBe(false)
  })

  it('filters empty array without error', () => {
    const result = filterByVisibility([], { userId: 'user-123' })
    expect(result).toEqual([])
  })
})
