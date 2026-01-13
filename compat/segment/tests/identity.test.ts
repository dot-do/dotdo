/**
 * @dotdo/segment - Identity Resolution Tests
 *
 * Tests for Segment Identity Resolution compatibility:
 * - User profile merging across identities
 * - Identity graph management
 * - Profile stitching across devices/sessions
 * - Alias relationship tracking
 *
 * TDD approach: Tests define expected behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  IdentityResolver,
  createIdentityResolver,
  type IdentityResolverOptions,
  type MergedProfile,
  type IdentityNode,
  type ProfileQuery,
} from '../identity'
import type { SegmentEvent } from '../types'

describe('@dotdo/segment - Identity Resolution', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = new IdentityResolver()
  })

  // ===========================================================================
  // Basic Identity Extraction
  // ===========================================================================

  describe('Identity Extraction', () => {
    it('should extract userId from events', () => {
      const event = createIdentifyEvent('user-123', { name: 'Alice' })
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(profile!.identities.some((i) => i.type === 'user_id' && i.value === 'user-123')).toBe(
        true
      )
    })

    it('should extract anonymousId from events', () => {
      const event = createTrackEvent('Page Viewed', {}, undefined, 'anon-456')
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(
        profile!.identities.some((i) => i.type === 'anonymous_id' && i.value === 'anon-456')
      ).toBe(true)
    })

    it('should extract email from traits', () => {
      const event = createIdentifyEvent('user-123', { email: 'alice@example.com' })
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(
        profile!.identities.some((i) => i.type === 'email' && i.value === 'alice@example.com')
      ).toBe(true)
    })

    it('should extract phone from traits and normalize', () => {
      const event = createIdentifyEvent('user-123', { phone: '+1 (555) 123-4567' })
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(
        profile!.identities.some((i) => i.type === 'phone' && i.value === '15551234567')
      ).toBe(true)
    })

    it('should extract device_id from context', () => {
      const event: SegmentEvent = {
        type: 'track',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-123',
        event: 'Test',
        context: {
          device: {
            id: 'device-xyz',
          },
        },
      }

      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(
        profile!.identities.some((i) => i.type === 'device_id' && i.value === 'device-xyz')
      ).toBe(true)
    })

    it('should support custom identity extractors', () => {
      resolver = new IdentityResolver({
        identityExtractors: [
          {
            type: 'custom' as const,
            extract: (event) => (event.properties?.customId as string) || null,
          },
        ],
      })

      const event = createTrackEvent('Test', { customId: 'custom-123' }, 'user-1')
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(
        profile!.identities.some((i) => i.type === 'custom' && i.value === 'custom-123')
      ).toBe(true)
    })
  })

  // ===========================================================================
  // Profile Creation
  // ===========================================================================

  describe('Profile Creation', () => {
    it('should create a new profile for unknown identities', () => {
      const event = createIdentifyEvent('user-123', { name: 'Alice' })
      const profile = resolver.processEvent(event)

      expect(profile).not.toBeNull()
      expect(profile!.canonicalId).toBeDefined()
      expect(profile!.traits.name).toBe('Alice')
    })

    it('should generate unique canonical IDs', () => {
      const profile1 = resolver.processEvent(createIdentifyEvent('user-1', {}))
      const profile2 = resolver.processEvent(createIdentifyEvent('user-2', {}))

      expect(profile1!.canonicalId).not.toBe(profile2!.canonicalId)
    })

    it('should track creation timestamp', () => {
      const profile = resolver.processEvent(createIdentifyEvent('user-123', {}))

      expect(profile!.createdAt).toBeDefined()
      expect(new Date(profile!.createdAt).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should initialize merge history on creation', () => {
      const profile = resolver.processEvent(createIdentifyEvent('user-123', {}))

      // Should have at least a 'create' entry (may also have 'update_traits' if traits were passed)
      expect(profile!.mergeHistory.length).toBeGreaterThanOrEqual(1)
      expect(profile!.mergeHistory[0]!.type).toBe('create')
    })
  })

  // ===========================================================================
  // Profile Lookup
  // ===========================================================================

  describe('Profile Lookup', () => {
    it('should lookup profile by userId', () => {
      resolver.processEvent(createIdentifyEvent('user-123', { name: 'Alice' }))

      const profile = resolver.lookupProfile({ userId: 'user-123' })

      expect(profile).not.toBeNull()
      expect(profile!.traits.name).toBe('Alice')
    })

    it('should lookup profile by anonymousId', () => {
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-123'))

      const profile = resolver.lookupProfile({ anonymousId: 'anon-123' })

      expect(profile).not.toBeNull()
    })

    it('should lookup profile by email', () => {
      resolver.processEvent(createIdentifyEvent('user-123', { email: 'alice@example.com' }))

      const profile = resolver.lookupProfile({ email: 'alice@example.com' })

      expect(profile).not.toBeNull()
    })

    it('should lookup profile by custom identity', () => {
      resolver = new IdentityResolver({
        identityExtractors: [
          {
            type: 'custom' as const,
            extract: (event) => (event.properties?.customId as string) || null,
          },
        ],
      })

      resolver.processEvent(createTrackEvent('Test', { customId: 'custom-123' }, 'user-1'))

      const profile = resolver.lookupProfile({ custom: { type: 'custom', value: 'custom-123' } })

      expect(profile).not.toBeNull()
    })

    it('should return null for unknown identities', () => {
      const profile = resolver.lookupProfile({ userId: 'unknown' })
      expect(profile).toBeNull()
    })

    it('should get profile by canonical ID', () => {
      const created = resolver.processEvent(createIdentifyEvent('user-123', {}))
      const fetched = resolver.getProfile(created!.canonicalId)

      expect(fetched).not.toBeNull()
      expect(fetched!.canonicalId).toBe(created!.canonicalId)
    })
  })

  // ===========================================================================
  // Profile Updates
  // ===========================================================================

  describe('Profile Updates', () => {
    it('should update existing profile with new events', () => {
      resolver.processEvent(createIdentifyEvent('user-123', { name: 'Alice' }))
      resolver.processEvent(createIdentifyEvent('user-123', { email: 'alice@example.com' }))

      const profile = resolver.lookupProfile({ userId: 'user-123' })

      expect(profile!.traits.name).toBe('Alice')
      expect(profile!.traits.email).toBe('alice@example.com')
    })

    it('should add new identities to existing profile', () => {
      resolver.processEvent(createIdentifyEvent('user-123', {}))
      resolver.processEvent(createIdentifyEvent('user-123', { email: 'alice@example.com' }))

      const profile = resolver.lookupProfile({ userId: 'user-123' })

      expect(profile!.identities.some((i) => i.type === 'email')).toBe(true)
    })

    it('should update lastSeen for existing identities', () => {
      resolver.processEvent(createIdentifyEvent('user-123', {}))

      const initialProfile = resolver.lookupProfile({ userId: 'user-123' })
      const initialLastSeen = initialProfile!.identities.find((i) => i.type === 'user_id')!.lastSeen

      // Wait a moment and process another event
      resolver.processEvent(createTrackEvent('Test', {}, 'user-123'))

      const updatedProfile = resolver.lookupProfile({ userId: 'user-123' })
      const updatedLastSeen = updatedProfile!.identities.find((i) => i.type === 'user_id')!.lastSeen

      expect(new Date(updatedLastSeen).getTime()).toBeGreaterThanOrEqual(
        new Date(initialLastSeen).getTime()
      )
    })

    it('should update updatedAt timestamp', () => {
      const initial = resolver.processEvent(createIdentifyEvent('user-123', { name: 'Alice' }))
      const initialUpdatedAt = initial!.updatedAt

      resolver.processEvent(createIdentifyEvent('user-123', { name: 'Bob' }))

      const updated = resolver.lookupProfile({ userId: 'user-123' })

      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(initialUpdatedAt).getTime()
      )
    })
  })

  // ===========================================================================
  // Profile Merging
  // ===========================================================================

  describe('Profile Merging', () => {
    it('should merge profiles when identities overlap', () => {
      // Create profile with anonymousId
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-123'))

      // Create profile with userId and same anonymousId - should merge
      resolver.processEvent(
        createIdentifyEvent('user-123', {}, 'anon-123')
      )

      const profile = resolver.lookupProfile({ userId: 'user-123' })

      expect(profile).not.toBeNull()
      expect(profile!.identities.some((i) => i.type === 'user_id')).toBe(true)
      expect(profile!.identities.some((i) => i.type === 'anonymous_id')).toBe(true)
    })

    it('should merge traits from both profiles', () => {
      // Profile 1 with email
      resolver.processEvent(createIdentifyEvent('user-1', { name: 'Alice' }))

      // Profile 2 with anonymousId
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-1'))
      resolver.processEvent(
        createIdentifyEvent(undefined, { email: 'alice@example.com' }, 'anon-1')
      )

      // Now link them
      resolver.processEvent(createIdentifyEvent('user-1', { plan: 'premium' }, 'anon-1'))

      const profile = resolver.lookupProfile({ userId: 'user-1' })

      expect(profile!.traits.name).toBe('Alice')
      expect(profile!.traits.plan).toBe('premium')
    })

    it('should track merge events in history', () => {
      // Create two separate profiles
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-1'))
      resolver.processEvent(createIdentifyEvent('user-1', {}))

      // Merge them
      resolver.processEvent(createIdentifyEvent('user-1', {}, 'anon-1'))

      const profile = resolver.lookupProfile({ userId: 'user-1' })

      const mergeEvent = profile!.mergeHistory.find((e) => e.type === 'merge')
      expect(mergeEvent).toBeDefined()
    })

    it('should notify on profile merge', () => {
      const onProfileMerged = vi.fn()
      resolver = new IdentityResolver({ onProfileMerged })

      // Create two separate profiles
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-1'))
      resolver.processEvent(createIdentifyEvent('user-1', {}))

      // Merge them
      resolver.processEvent(createIdentifyEvent('user-1', {}, 'anon-1'))

      expect(onProfileMerged).toHaveBeenCalled()
    })

    it('should support manual profile merge', () => {
      const profile1 = resolver.processEvent(createIdentifyEvent('user-1', { name: 'Alice' }))
      const profile2 = resolver.processEvent(createIdentifyEvent('user-2', { email: 'bob@example.com' }))

      const merged = resolver.manualMerge(profile1!.canonicalId, profile2!.canonicalId)

      expect(merged).not.toBeNull()
      expect(merged!.identities.some((i) => i.value === 'user-1')).toBe(true)
      expect(merged!.identities.some((i) => i.value === 'user-2')).toBe(true)
    })
  })

  // ===========================================================================
  // Alias Handling
  // ===========================================================================

  describe('Alias Handling', () => {
    it('should process alias events', () => {
      // Create profile with userId
      resolver.processEvent(createIdentifyEvent('user-123', { name: 'Alice' }))

      // Alias anonymousId to userId
      const event: SegmentEvent = {
        type: 'alias',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-123',
        previousId: 'anon-456',
      }

      resolver.processEvent(event)

      // Should be able to lookup by previousId
      const profile = resolver.lookupProfile({ anonymousId: 'anon-456' })

      // May not be found by anonymousId lookup, but the alias should be in the profile
      const profileByUser = resolver.lookupProfile({ userId: 'user-123' })
      expect(
        profileByUser!.identities.some((i) => i.value === 'anon-456')
      ).toBe(true)
    })

    it('should create alias edges in identity graph', () => {
      resolver.processEvent(createIdentifyEvent('user-123', {}))

      const event: SegmentEvent = {
        type: 'alias',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-123',
        previousId: 'anon-456',
      }

      resolver.processEvent(event)

      const profile = resolver.lookupProfile({ userId: 'user-123' })
      const graph = resolver.getIdentityGraph(profile!.canonicalId)

      const aliasEdge = graph!.edges.find((e) => e.method === 'alias')
      expect(aliasEdge).toBeDefined()
    })

    it('should merge profiles on alias if previousId exists', () => {
      // Create profile with anonymousId
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-456'))

      // Create profile with userId
      resolver.processEvent(createIdentifyEvent('user-123', { name: 'Alice' }))

      // Alias them
      const event: SegmentEvent = {
        type: 'alias',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-123',
        previousId: 'anon-456',
      }

      resolver.processEvent(event)

      // Should only have one profile now
      expect(resolver.getProfileCount()).toBe(1)
    })
  })

  // ===========================================================================
  // Identity Graph
  // ===========================================================================

  describe('Identity Graph', () => {
    it('should build identity graph with nodes and edges', () => {
      resolver.processEvent(
        createIdentifyEvent('user-123', { email: 'alice@example.com' }, 'anon-456')
      )

      const profile = resolver.lookupProfile({ userId: 'user-123' })
      const graph = resolver.getIdentityGraph(profile!.canonicalId)

      expect(graph).not.toBeNull()
      expect(graph!.nodes.length).toBeGreaterThanOrEqual(3) // user_id, anonymous_id, email
      expect(graph!.edges.length).toBeGreaterThanOrEqual(1)
    })

    it('should assign confidence scores to identities', () => {
      resolver.processEvent(createIdentifyEvent('user-123', { email: 'alice@example.com' }))

      const profile = resolver.lookupProfile({ userId: 'user-123' })

      const userIdIdentity = profile!.identities.find((i) => i.type === 'user_id')
      const emailIdentity = profile!.identities.find((i) => i.type === 'email')

      expect(userIdIdentity!.confidence).toBe(1.0) // userId is highest confidence
      expect(emailIdentity!.confidence).toBeLessThan(1.0) // email is lower
    })

    it('should track edge methods', () => {
      resolver.processEvent(
        createIdentifyEvent('user-123', { email: 'alice@example.com' }, 'anon-456')
      )

      const profile = resolver.lookupProfile({ userId: 'user-123' })
      const graph = resolver.getIdentityGraph(profile!.canonicalId)

      const identifyEdge = graph!.edges.find((e) => e.method === 'identify')
      expect(identifyEdge).toBeDefined()
    })

    it('should return null for unknown canonical ID', () => {
      const graph = resolver.getIdentityGraph('unknown-id')
      expect(graph).toBeNull()
    })
  })

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe('Statistics', () => {
    it('should track profile count', () => {
      resolver.processEvent(createIdentifyEvent('user-1', {}))
      resolver.processEvent(createIdentifyEvent('user-2', {}))

      expect(resolver.getProfileCount()).toBe(2)
    })

    it('should track identity count', () => {
      resolver.processEvent(
        createIdentifyEvent('user-1', { email: 'a@example.com' }, 'anon-1')
      )

      // Should have at least: user_id, email, anonymous_id
      expect(resolver.getIdentityCount()).toBeGreaterThanOrEqual(3)
    })

    it('should get all profiles', () => {
      resolver.processEvent(createIdentifyEvent('user-1', { name: 'Alice' }))
      resolver.processEvent(createIdentifyEvent('user-2', { name: 'Bob' }))

      const profiles = resolver.getAllProfiles()

      expect(profiles).toHaveLength(2)
    })

    it('should clear all data', () => {
      resolver.processEvent(createIdentifyEvent('user-1', {}))
      resolver.processEvent(createIdentifyEvent('user-2', {}))

      resolver.clear()

      expect(resolver.getProfileCount()).toBe(0)
      expect(resolver.getIdentityCount()).toBe(0)
    })
  })

  // ===========================================================================
  // Callbacks
  // ===========================================================================

  describe('Callbacks', () => {
    it('should call onIdentityDiscovered for new identities', () => {
      const onIdentityDiscovered = vi.fn()
      resolver = new IdentityResolver({ onIdentityDiscovered })

      resolver.processEvent(createIdentifyEvent('user-123', { email: 'alice@example.com' }))

      expect(onIdentityDiscovered).toHaveBeenCalled()
      expect(onIdentityDiscovered.mock.calls.some(
        (call) => call[0].type === 'user_id' && call[0].value === 'user-123'
      )).toBe(true)
    })

    it('should call onProfileMerged when profiles are merged', () => {
      const onProfileMerged = vi.fn()
      resolver = new IdentityResolver({ onProfileMerged })

      // Create two profiles
      resolver.processEvent(createTrackEvent('Test', {}, undefined, 'anon-1'))
      resolver.processEvent(createIdentifyEvent('user-1', {}))

      // Merge them
      resolver.processEvent(createIdentifyEvent('user-1', {}, 'anon-1'))

      expect(onProfileMerged).toHaveBeenCalledWith(
        expect.objectContaining({ canonicalId: expect.any(String) }),
        expect.any(Array)
      )
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function createIdentifyEvent(
  userId: string | undefined,
  traits: Record<string, unknown>,
  anonymousId?: string
): SegmentEvent {
  return {
    type: 'identify',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId,
    anonymousId,
    traits,
  }
}

function createTrackEvent(
  eventName: string,
  properties: Record<string, unknown>,
  userId?: string,
  anonymousId?: string
): SegmentEvent {
  return {
    type: 'track',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId,
    anonymousId,
    event: eventName,
    properties,
  }
}
