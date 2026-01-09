/**
 * TDD Red Phase Tests: Visibility Types for Things
 *
 * Tests for visibility control on Things:
 * - Visibility field on ThingData
 * - Visibility type export ('public' | 'unlisted' | 'org' | 'user')
 * - Helper functions: isPublic(), isUnlisted(), isOrgVisible(), isUserOnly()
 * - Permission check: canView(thing, actor)
 *
 * These tests define the expected behavior BEFORE implementation.
 * All tests should FAIL initially because visibility types/helpers don't exist yet.
 *
 * @see dotdo-xdgu
 */

import { describe, it, expect } from 'vitest'
import {
  type ThingData,
  type Visibility,
  isPublic,
  isUnlisted,
  isOrgVisible,
  isUserOnly,
  canView,
} from '../../types/Thing'

describe('Visibility Types', () => {
  /**
   * Core Requirement: ThingData includes visibility field
   *
   * The ThingData interface should have an optional visibility field
   * that controls who can access the Thing.
   */
  describe('ThingData visibility field', () => {
    it('ThingData accepts visibility field', () => {
      const thing: ThingData = {
        $id: 'https://example.com/thing/1',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(thing.visibility).toBe('public')
    })

    it('visibility field is optional (defaults to undefined)', () => {
      const thing: ThingData = {
        $id: 'https://example.com/thing/2',
        $type: 'https://example.com/Type',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(thing.visibility).toBeUndefined()
    })

    it('accepts all valid visibility values', () => {
      const visibilities: Visibility[] = ['public', 'unlisted', 'org', 'user']

      for (const visibility of visibilities) {
        const thing: ThingData = {
          $id: `https://example.com/thing/${visibility}`,
          $type: 'https://example.com/Type',
          visibility,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        expect(thing.visibility).toBe(visibility)
      }
    })
  })

  /**
   * Core Requirement: Visibility type export
   *
   * The Visibility type should be exported and include the four valid values:
   * 'public', 'unlisted', 'org', 'user'
   */
  describe('Visibility type', () => {
    it('Visibility type includes public', () => {
      const visibility: Visibility = 'public'
      expect(visibility).toBe('public')
    })

    it('Visibility type includes unlisted', () => {
      const visibility: Visibility = 'unlisted'
      expect(visibility).toBe('unlisted')
    })

    it('Visibility type includes org', () => {
      const visibility: Visibility = 'org'
      expect(visibility).toBe('org')
    })

    it('Visibility type includes user', () => {
      const visibility: Visibility = 'user'
      expect(visibility).toBe('user')
    })
  })

  /**
   * Core Requirement: isPublic() helper function
   *
   * Returns true if the Thing is publicly visible to anyone.
   */
  describe('isPublic()', () => {
    it('returns true for public visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isPublic(thing)).toBe(true)
    })

    it('returns false for unlisted visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isPublic(thing)).toBe(false)
    })

    it('returns false for org visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isPublic(thing)).toBe(false)
    })

    it('returns false for user visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isPublic(thing)).toBe(false)
    })

    it('returns false for undefined visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/no-visibility',
        $type: 'https://example.com/Type',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isPublic(thing)).toBe(false)
    })
  })

  /**
   * Core Requirement: isUnlisted() helper function
   *
   * Returns true if the Thing is unlisted (accessible via direct link but not discoverable).
   */
  describe('isUnlisted()', () => {
    it('returns true for unlisted visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUnlisted(thing)).toBe(true)
    })

    it('returns false for public visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUnlisted(thing)).toBe(false)
    })

    it('returns false for org visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUnlisted(thing)).toBe(false)
    })

    it('returns false for user visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUnlisted(thing)).toBe(false)
    })
  })

  /**
   * Core Requirement: isOrgVisible() helper function
   *
   * Returns true if the Thing is visible to organization members.
   */
  describe('isOrgVisible()', () => {
    it('returns true for org visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isOrgVisible(thing)).toBe(true)
    })

    it('returns false for public visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isOrgVisible(thing)).toBe(false)
    })

    it('returns false for unlisted visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isOrgVisible(thing)).toBe(false)
    })

    it('returns false for user visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isOrgVisible(thing)).toBe(false)
    })
  })

  /**
   * Core Requirement: isUserOnly() helper function
   *
   * Returns true if the Thing is only visible to the owner/creator.
   */
  describe('isUserOnly()', () => {
    it('returns true for user visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUserOnly(thing)).toBe(true)
    })

    it('returns false for public visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUserOnly(thing)).toBe(false)
    })

    it('returns false for unlisted visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUserOnly(thing)).toBe(false)
    })

    it('returns false for org visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUserOnly(thing)).toBe(false)
    })

    it('returns true for undefined visibility (default to private)', () => {
      const thing: ThingData = {
        $id: 'https://example.com/no-visibility',
        $type: 'https://example.com/Type',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(isUserOnly(thing)).toBe(true)
    })
  })
})

describe('canView() Permission Check', () => {
  /**
   * Actor type for permission checks.
   * This represents who is trying to view the Thing.
   */
  interface Actor {
    userId?: string
    orgId?: string
  }

  /**
   * Core Requirement: Public Things are viewable by anyone
   */
  describe('public visibility', () => {
    it('anonymous user can view public Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = {}

      expect(canView(thing, actor)).toBe(true)
    })

    it('authenticated user can view public Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123' }

      expect(canView(thing, actor)).toBe(true)
    })

    it('org member can view public Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/public-thing',
        $type: 'https://example.com/Type',
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123', orgId: 'org-456' }

      expect(canView(thing, actor)).toBe(true)
    })
  })

  /**
   * Core Requirement: Unlisted Things are viewable by anyone with link
   */
  describe('unlisted visibility', () => {
    it('anonymous user can view unlisted Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = {}

      expect(canView(thing, actor)).toBe(true)
    })

    it('authenticated user can view unlisted Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/unlisted-thing',
        $type: 'https://example.com/Type',
        visibility: 'unlisted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123' }

      expect(canView(thing, actor)).toBe(true)
    })
  })

  /**
   * Core Requirement: Org Things require org membership
   */
  describe('org visibility', () => {
    it('anonymous user cannot view org Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        meta: { orgId: 'org-456' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = {}

      expect(canView(thing, actor)).toBe(false)
    })

    it('authenticated user without org cannot view org Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        meta: { orgId: 'org-456' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123' }

      expect(canView(thing, actor)).toBe(false)
    })

    it('member of different org cannot view org Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        meta: { orgId: 'org-456' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123', orgId: 'org-789' }

      expect(canView(thing, actor)).toBe(false)
    })

    it('member of same org can view org Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/org-thing',
        $type: 'https://example.com/Type',
        visibility: 'org',
        meta: { orgId: 'org-456' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123', orgId: 'org-456' }

      expect(canView(thing, actor)).toBe(true)
    })
  })

  /**
   * Core Requirement: User-only Things require owner authentication
   */
  describe('user visibility', () => {
    it('anonymous user cannot view user-only Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = {}

      expect(canView(thing, actor)).toBe(false)
    })

    it('different authenticated user cannot view user-only Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-456' }

      expect(canView(thing, actor)).toBe(false)
    })

    it('owner can view their user-only Thing', () => {
      const thing: ThingData = {
        $id: 'https://example.com/user-thing',
        $type: 'https://example.com/Type',
        visibility: 'user',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123' }

      expect(canView(thing, actor)).toBe(true)
    })
  })

  /**
   * Core Requirement: Undefined visibility defaults to user-only (private)
   */
  describe('undefined visibility (defaults to private)', () => {
    it('anonymous user cannot view Thing with undefined visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/private-thing',
        $type: 'https://example.com/Type',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = {}

      expect(canView(thing, actor)).toBe(false)
    })

    it('different user cannot view Thing with undefined visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/private-thing',
        $type: 'https://example.com/Type',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-456' }

      expect(canView(thing, actor)).toBe(false)
    })

    it('owner can view Thing with undefined visibility', () => {
      const thing: ThingData = {
        $id: 'https://example.com/private-thing',
        $type: 'https://example.com/Type',
        meta: { ownerId: 'user-123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const actor: Actor = { userId: 'user-123' }

      expect(canView(thing, actor)).toBe(true)
    })
  })
})
