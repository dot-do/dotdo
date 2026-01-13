/**
 * VisibilityModule Unit Tests
 *
 * Tests for the extracted VisibilityModule from DOBase.
 * Verifies:
 * - Visibility-based access control (public, unlisted, org, user)
 * - Thing filtering based on actor context
 * - Owner and organization membership checks
 * - Assertion helpers for access control
 *
 * Part of Phase 1 DOBase decomposition (low-risk extractions).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  VisibilityModule,
  type Visibility,
  type VisibleThing,
  type ThingGetter,
} from '../modules/VisibilityModule'
import type { ActorContext } from '../modules/ActorContextModule'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Create a mock thing with visibility and ownership data
 */
function createMockThing(options: {
  visibility?: Visibility
  ownerId?: string
  orgId?: string
}): VisibleThing {
  return {
    data: {
      visibility: options.visibility,
      ownerId: options.ownerId,
      orgId: options.orgId,
    },
  }
}

/**
 * Create a mock thing with meta-style ownership data
 */
function createMockThingWithMeta(options: {
  visibility?: Visibility
  ownerId?: string
  orgId?: string
}): VisibleThing {
  return {
    data: {
      visibility: options.visibility,
      meta: {
        ownerId: options.ownerId,
        orgId: options.orgId,
      },
    },
  }
}

/**
 * Create a mock actor context getter
 */
function createActorContextGetter(context: ActorContext): () => ActorContext {
  return () => context
}

// ============================================================================
// TEST SUITE: VisibilityModule
// ============================================================================

describe('VisibilityModule', () => {
  let visibilityModule: VisibilityModule
  let currentActorContext: ActorContext

  beforeEach(() => {
    currentActorContext = {}
    visibilityModule = new VisibilityModule(() => currentActorContext)
  })

  // ==========================================================================
  // CONSTRUCTOR TESTS
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with actor context getter', () => {
      const module = new VisibilityModule(() => ({}))
      expect(module).toBeDefined()
      expect(module).toBeInstanceOf(VisibilityModule)
    })
  })

  // ==========================================================================
  // getVisibility TESTS
  // ==========================================================================

  describe('getVisibility', () => {
    it('should return "user" for null thing', () => {
      expect(visibilityModule.getVisibility(null)).toBe('user')
    })

    it('should return "user" for undefined thing', () => {
      expect(visibilityModule.getVisibility(undefined)).toBe('user')
    })

    it('should return "user" when visibility not specified', () => {
      const thing = createMockThing({})
      expect(visibilityModule.getVisibility(thing)).toBe('user')
    })

    it('should return "public" when visibility is public', () => {
      const thing = createMockThing({ visibility: 'public' })
      expect(visibilityModule.getVisibility(thing)).toBe('public')
    })

    it('should return "unlisted" when visibility is unlisted', () => {
      const thing = createMockThing({ visibility: 'unlisted' })
      expect(visibilityModule.getVisibility(thing)).toBe('unlisted')
    })

    it('should return "org" when visibility is org', () => {
      const thing = createMockThing({ visibility: 'org' })
      expect(visibilityModule.getVisibility(thing)).toBe('org')
    })

    it('should return "user" when visibility is user', () => {
      const thing = createMockThing({ visibility: 'user' })
      expect(visibilityModule.getVisibility(thing)).toBe('user')
    })

    it('should handle thing with null data', () => {
      const thing: VisibleThing = { data: null }
      expect(visibilityModule.getVisibility(thing)).toBe('user')
    })

    it('should handle thing with undefined data', () => {
      const thing: VisibleThing = { data: undefined }
      expect(visibilityModule.getVisibility(thing)).toBe('user')
    })
  })

  // ==========================================================================
  // canViewThing TESTS
  // ==========================================================================

  describe('canViewThing', () => {
    describe('null/undefined handling', () => {
      it('should return false for null thing', () => {
        expect(visibilityModule.canViewThing(null)).toBe(false)
      })

      it('should return false for undefined thing', () => {
        expect(visibilityModule.canViewThing(undefined)).toBe(false)
      })
    })

    describe('public visibility', () => {
      it('should allow anonymous access to public things', () => {
        currentActorContext = {}
        const thing = createMockThing({ visibility: 'public' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should allow authenticated access to public things', () => {
        currentActorContext = { userId: 'usr_123' }
        const thing = createMockThing({ visibility: 'public' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })
    })

    describe('unlisted visibility', () => {
      it('should allow anonymous access to unlisted things', () => {
        currentActorContext = {}
        const thing = createMockThing({ visibility: 'unlisted' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should allow authenticated access to unlisted things', () => {
        currentActorContext = { userId: 'usr_123' }
        const thing = createMockThing({ visibility: 'unlisted' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })
    })

    describe('org visibility', () => {
      it('should deny anonymous access to org things', () => {
        currentActorContext = {}
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })

      it('should deny access when user has no org', () => {
        currentActorContext = { userId: 'usr_123' }
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })

      it('should deny access when user is in different org', () => {
        currentActorContext = { userId: 'usr_123', orgId: 'org_different' }
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })

      it('should allow access when user is in same org', () => {
        currentActorContext = { userId: 'usr_123', orgId: 'org_456' }
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should check orgId from meta object', () => {
        currentActorContext = { userId: 'usr_123', orgId: 'org_456' }
        const thing = createMockThingWithMeta({ visibility: 'org', orgId: 'org_456' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })
    })

    describe('user visibility (default)', () => {
      it('should deny anonymous access to user things', () => {
        currentActorContext = {}
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })

      it('should deny access when user is not owner', () => {
        currentActorContext = { userId: 'usr_other' }
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })

      it('should allow access when user is owner', () => {
        currentActorContext = { userId: 'usr_owner' }
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should check ownerId from meta object', () => {
        currentActorContext = { userId: 'usr_owner' }
        const thing = createMockThingWithMeta({ visibility: 'user', ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should deny access when thing has no owner and visibility is user', () => {
        currentActorContext = { userId: 'usr_123' }
        const thing = createMockThing({ visibility: 'user' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })
    })

    describe('default visibility (no visibility set)', () => {
      it('should treat unset visibility as user visibility', () => {
        currentActorContext = { userId: 'usr_owner' }
        const thing = createMockThing({ ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(true)
      })

      it('should deny access for unset visibility when not owner', () => {
        currentActorContext = { userId: 'usr_other' }
        const thing = createMockThing({ ownerId: 'usr_owner' })
        expect(visibilityModule.canViewThing(thing)).toBe(false)
      })
    })
  })

  // ==========================================================================
  // assertCanView TESTS
  // ==========================================================================

  describe('assertCanView', () => {
    describe('null/undefined handling', () => {
      it('should throw for null thing', () => {
        expect(() => visibilityModule.assertCanView(null)).toThrow('Thing not found')
      })

      it('should throw for undefined thing', () => {
        expect(() => visibilityModule.assertCanView(undefined)).toThrow('Thing not found')
      })

      it('should throw with custom message for null thing', () => {
        expect(() => visibilityModule.assertCanView(null, 'Custom not found')).toThrow(
          'Custom not found'
        )
      })
    })

    describe('access denied', () => {
      it('should throw for org visibility without membership', () => {
        currentActorContext = { userId: 'usr_123' }
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })

        expect(() => visibilityModule.assertCanView(thing)).toThrow(
          'Organization membership required'
        )
      })

      it('should throw for user visibility without ownership', () => {
        currentActorContext = { userId: 'usr_other' }
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })

        expect(() => visibilityModule.assertCanView(thing)).toThrow('Owner access required')
      })

      it('should throw with custom message when provided', () => {
        currentActorContext = { userId: 'usr_other' }
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })

        expect(() => visibilityModule.assertCanView(thing, 'Not your thing')).toThrow(
          'Not your thing'
        )
      })
    })

    describe('access allowed', () => {
      it('should not throw for public things', () => {
        const thing = createMockThing({ visibility: 'public' })
        expect(() => visibilityModule.assertCanView(thing)).not.toThrow()
      })

      it('should not throw for unlisted things', () => {
        const thing = createMockThing({ visibility: 'unlisted' })
        expect(() => visibilityModule.assertCanView(thing)).not.toThrow()
      })

      it('should not throw for org things with membership', () => {
        currentActorContext = { userId: 'usr_123', orgId: 'org_456' }
        const thing = createMockThing({ visibility: 'org', orgId: 'org_456' })
        expect(() => visibilityModule.assertCanView(thing)).not.toThrow()
      })

      it('should not throw for user things with ownership', () => {
        currentActorContext = { userId: 'usr_owner' }
        const thing = createMockThing({ visibility: 'user', ownerId: 'usr_owner' })
        expect(() => visibilityModule.assertCanView(thing)).not.toThrow()
      })
    })
  })

  // ==========================================================================
  // filterVisibleThings TESTS
  // ==========================================================================

  describe('filterVisibleThings', () => {
    it('should return empty array for empty input', () => {
      const result = visibilityModule.filterVisibleThings([])
      expect(result).toEqual([])
    })

    it('should filter out inaccessible things', () => {
      currentActorContext = { userId: 'usr_123', orgId: 'org_456' }

      const things = [
        createMockThing({ visibility: 'public' }), // visible
        createMockThing({ visibility: 'user', ownerId: 'usr_other' }), // not visible
        createMockThing({ visibility: 'org', orgId: 'org_456' }), // visible
        createMockThing({ visibility: 'org', orgId: 'org_different' }), // not visible
        createMockThing({ visibility: 'user', ownerId: 'usr_123' }), // visible
      ]

      const result = visibilityModule.filterVisibleThings(things)

      expect(result.length).toBe(3)
      expect(result[0].data?.visibility).toBe('public')
      expect(result[1].data?.visibility).toBe('org')
      expect(result[2].data?.visibility).toBe('user')
    })

    it('should return all public/unlisted things for anonymous users', () => {
      currentActorContext = {}

      const things = [
        createMockThing({ visibility: 'public' }),
        createMockThing({ visibility: 'unlisted' }),
        createMockThing({ visibility: 'org', orgId: 'org_456' }),
        createMockThing({ visibility: 'user', ownerId: 'usr_123' }),
      ]

      const result = visibilityModule.filterVisibleThings(things)

      expect(result.length).toBe(2)
    })

    it('should preserve original array order', () => {
      currentActorContext = {}

      const thing1 = { ...createMockThing({ visibility: 'public' }), id: '1' }
      const thing2 = { ...createMockThing({ visibility: 'unlisted' }), id: '2' }
      const thing3 = { ...createMockThing({ visibility: 'public' }), id: '3' }

      const result = visibilityModule.filterVisibleThings([thing1, thing2, thing3])

      expect(result).toEqual([thing1, thing2, thing3])
    })

    it('should return empty array when no things are visible', () => {
      currentActorContext = { userId: 'usr_different' }

      const things = [
        createMockThing({ visibility: 'user', ownerId: 'usr_owner1' }),
        createMockThing({ visibility: 'user', ownerId: 'usr_owner2' }),
        createMockThing({ visibility: 'org', orgId: 'org_other' }),
      ]

      const result = visibilityModule.filterVisibleThings(things)

      expect(result).toEqual([])
    })
  })

  // ==========================================================================
  // getVisibleThing TESTS
  // ==========================================================================

  describe('getVisibleThing', () => {
    it('should return null when thing not found', async () => {
      const getter: ThingGetter = vi.fn().mockResolvedValue(null)

      const result = await visibilityModule.getVisibleThing('id_123', getter)

      expect(result).toBeNull()
      expect(getter).toHaveBeenCalledWith('id_123')
    })

    it('should return thing when visible', async () => {
      currentActorContext = { userId: 'usr_owner' }
      const thing = {
        $id: 'thing_123',
        data: { visibility: 'user', ownerId: 'usr_owner' },
      }
      const getter: ThingGetter = vi.fn().mockResolvedValue(thing)

      const result = await visibilityModule.getVisibleThing('thing_123', getter)

      expect(result).toBe(thing)
    })

    it('should return null when thing exists but not visible', async () => {
      currentActorContext = { userId: 'usr_other' }
      const thing = {
        $id: 'thing_123',
        data: { visibility: 'user', ownerId: 'usr_owner' },
      }
      const getter: ThingGetter = vi.fn().mockResolvedValue(thing)

      const result = await visibilityModule.getVisibleThing('thing_123', getter)

      expect(result).toBeNull()
    })

    it('should return public things for anonymous users', async () => {
      currentActorContext = {}
      const thing = {
        $id: 'thing_123',
        data: { visibility: 'public' },
      }
      const getter: ThingGetter = vi.fn().mockResolvedValue(thing)

      const result = await visibilityModule.getVisibleThing('thing_123', getter)

      expect(result).toBe(thing)
    })
  })

  // ==========================================================================
  // isOwner TESTS
  // ==========================================================================

  describe('isOwner', () => {
    it('should return false for null thing', () => {
      currentActorContext = { userId: 'usr_123' }
      expect(visibilityModule.isOwner(null)).toBe(false)
    })

    it('should return false for undefined thing', () => {
      currentActorContext = { userId: 'usr_123' }
      expect(visibilityModule.isOwner(undefined)).toBe(false)
    })

    it('should return false when no userId in context', () => {
      currentActorContext = {}
      const thing = createMockThing({ ownerId: 'usr_123' })
      expect(visibilityModule.isOwner(thing)).toBe(false)
    })

    it('should return false when userId does not match ownerId', () => {
      currentActorContext = { userId: 'usr_different' }
      const thing = createMockThing({ ownerId: 'usr_owner' })
      expect(visibilityModule.isOwner(thing)).toBe(false)
    })

    it('should return true when userId matches ownerId', () => {
      currentActorContext = { userId: 'usr_owner' }
      const thing = createMockThing({ ownerId: 'usr_owner' })
      expect(visibilityModule.isOwner(thing)).toBe(true)
    })

    it('should check ownerId from meta object', () => {
      currentActorContext = { userId: 'usr_owner' }
      const thing = createMockThingWithMeta({ ownerId: 'usr_owner' })
      expect(visibilityModule.isOwner(thing)).toBe(true)
    })

    it('should return false when thing has no ownerId', () => {
      currentActorContext = { userId: 'usr_123' }
      const thing = createMockThing({})
      expect(visibilityModule.isOwner(thing)).toBe(false)
    })
  })

  // ==========================================================================
  // isInThingOrg TESTS
  // ==========================================================================

  describe('isInThingOrg', () => {
    it('should return false for null thing', () => {
      currentActorContext = { orgId: 'org_123' }
      expect(visibilityModule.isInThingOrg(null)).toBe(false)
    })

    it('should return false for undefined thing', () => {
      currentActorContext = { orgId: 'org_123' }
      expect(visibilityModule.isInThingOrg(undefined)).toBe(false)
    })

    it('should return false when no orgId in context', () => {
      currentActorContext = { userId: 'usr_123' }
      const thing = createMockThing({ orgId: 'org_456' })
      expect(visibilityModule.isInThingOrg(thing)).toBe(false)
    })

    it('should return false when orgId does not match', () => {
      currentActorContext = { orgId: 'org_different' }
      const thing = createMockThing({ orgId: 'org_456' })
      expect(visibilityModule.isInThingOrg(thing)).toBe(false)
    })

    it('should return true when orgId matches', () => {
      currentActorContext = { orgId: 'org_456' }
      const thing = createMockThing({ orgId: 'org_456' })
      expect(visibilityModule.isInThingOrg(thing)).toBe(true)
    })

    it('should check orgId from meta object', () => {
      currentActorContext = { orgId: 'org_456' }
      const thing = createMockThingWithMeta({ orgId: 'org_456' })
      expect(visibilityModule.isInThingOrg(thing)).toBe(true)
    })

    it('should return false when thing has no orgId', () => {
      currentActorContext = { orgId: 'org_123' }
      const thing = createMockThing({})
      expect(visibilityModule.isInThingOrg(thing)).toBe(false)
    })
  })

  // ==========================================================================
  // PRIORITY OF DATA FIELDS TESTS
  // ==========================================================================

  describe('data field priority', () => {
    it('should prefer meta.ownerId over data.ownerId', () => {
      currentActorContext = { userId: 'usr_meta' }
      const thing: VisibleThing = {
        data: {
          visibility: 'user',
          ownerId: 'usr_data',
          meta: {
            ownerId: 'usr_meta',
          },
        },
      }
      expect(visibilityModule.isOwner(thing)).toBe(true)
    })

    it('should fall back to data.ownerId when meta.ownerId is undefined', () => {
      currentActorContext = { userId: 'usr_data' }
      const thing: VisibleThing = {
        data: {
          visibility: 'user',
          ownerId: 'usr_data',
          meta: {},
        },
      }
      expect(visibilityModule.isOwner(thing)).toBe(true)
    })

    it('should prefer meta.orgId over data.orgId', () => {
      currentActorContext = { orgId: 'org_meta' }
      const thing: VisibleThing = {
        data: {
          visibility: 'org',
          orgId: 'org_data',
          meta: {
            orgId: 'org_meta',
          },
        },
      }
      expect(visibilityModule.isInThingOrg(thing)).toBe(true)
    })

    it('should fall back to data.orgId when meta.orgId is undefined', () => {
      currentActorContext = { orgId: 'org_data' }
      const thing: VisibleThing = {
        data: {
          visibility: 'org',
          orgId: 'org_data',
          meta: {},
        },
      }
      expect(visibilityModule.isInThingOrg(thing)).toBe(true)
    })
  })

  // ==========================================================================
  // INTEGRATION-LIKE TESTS
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle multi-tenant access control', () => {
      // Org A user trying to access various things
      currentActorContext = { userId: 'user_a1', orgId: 'org_a' }

      const orgAPublicThing = createMockThing({ visibility: 'public', orgId: 'org_a' })
      const orgAOrgThing = createMockThing({ visibility: 'org', orgId: 'org_a' })
      const orgAUserThing = createMockThing({
        visibility: 'user',
        ownerId: 'user_a1',
        orgId: 'org_a',
      })
      const orgBPublicThing = createMockThing({ visibility: 'public', orgId: 'org_b' })
      const orgBOrgThing = createMockThing({ visibility: 'org', orgId: 'org_b' })
      const orgBUserThing = createMockThing({
        visibility: 'user',
        ownerId: 'user_b1',
        orgId: 'org_b',
      })

      expect(visibilityModule.canViewThing(orgAPublicThing)).toBe(true)
      expect(visibilityModule.canViewThing(orgAOrgThing)).toBe(true)
      expect(visibilityModule.canViewThing(orgAUserThing)).toBe(true)
      expect(visibilityModule.canViewThing(orgBPublicThing)).toBe(true)
      expect(visibilityModule.canViewThing(orgBOrgThing)).toBe(false)
      expect(visibilityModule.canViewThing(orgBUserThing)).toBe(false)
    })

    it('should handle user switching context between requests', () => {
      const ownerThing = createMockThing({
        visibility: 'user',
        ownerId: 'usr_owner',
        orgId: 'org_shared',
      })
      const orgThing = createMockThing({ visibility: 'org', orgId: 'org_shared' })

      // User A - owner
      currentActorContext = { userId: 'usr_owner', orgId: 'org_shared' }
      expect(visibilityModule.canViewThing(ownerThing)).toBe(true)
      expect(visibilityModule.canViewThing(orgThing)).toBe(true)

      // User B - same org, not owner
      currentActorContext = { userId: 'usr_colleague', orgId: 'org_shared' }
      expect(visibilityModule.canViewThing(ownerThing)).toBe(false)
      expect(visibilityModule.canViewThing(orgThing)).toBe(true)

      // Anonymous user
      currentActorContext = {}
      expect(visibilityModule.canViewThing(ownerThing)).toBe(false)
      expect(visibilityModule.canViewThing(orgThing)).toBe(false)
    })

    it('should support admin-like universal access pattern', () => {
      // This tests how you might implement admin access by checking isOwner or isInThingOrg
      // and then granting access based on role (not visibility module's job, but shows composability)

      currentActorContext = { userId: 'usr_admin', orgId: 'org_admin' }

      const userThing = createMockThing({ visibility: 'user', ownerId: 'usr_other' })

      // Normal visibility check would deny
      expect(visibilityModule.canViewThing(userThing)).toBe(false)

      // But an admin layer could check:
      // - visibilityModule.getVisibility(thing) to see the policy
      // - Then apply admin override
      expect(visibilityModule.getVisibility(userThing)).toBe('user')
    })
  })
})
