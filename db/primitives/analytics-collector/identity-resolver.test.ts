/**
 * IdentityResolver Tests
 *
 * Tests for identity resolution and user merging functionality.
 * Covers:
 * - Anonymous user tracking
 * - Authenticated user identification
 * - Profile merging (anonymous -> authenticated)
 * - Identity graph management
 * - Auto-merge on email/phone
 * - Trait merge strategies
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  IdentityResolver,
  createIdentityResolver,
  type IdentityResolverOptions,
  type IdentifyInput,
  type AliasInput,
  type ResolvedIdentity,
  type MergeRecord,
} from './identity-resolver'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createResolver(options?: IdentityResolverOptions): IdentityResolver {
  return createIdentityResolver(options)
}

// ============================================================================
// CREATION AND CONFIGURATION
// ============================================================================

describe('IdentityResolver', () => {
  describe('creation', () => {
    it('should create with default options', () => {
      const resolver = createResolver()
      expect(resolver).toBeDefined()
      expect(resolver.options.maxAnonymousIds).toBe(100)
      expect(resolver.options.autoMergeOnEmail).toBe(false)
      expect(resolver.options.autoMergeOnPhone).toBe(false)
      expect(resolver.options.traitMergeStrategy).toBe('newest')
    })

    it('should create with custom options', () => {
      const resolver = createResolver({
        maxAnonymousIds: 50,
        autoMergeOnEmail: true,
        autoMergeOnPhone: true,
        traitMergeStrategy: 'merge',
        autoMergeThreshold: 0.9,
      })
      expect(resolver.options.maxAnonymousIds).toBe(50)
      expect(resolver.options.autoMergeOnEmail).toBe(true)
      expect(resolver.options.autoMergeOnPhone).toBe(true)
      expect(resolver.options.traitMergeStrategy).toBe('merge')
      expect(resolver.options.autoMergeThreshold).toBe(0.9)
    })

    it('should work with new keyword', () => {
      const resolver = new IdentityResolver()
      expect(resolver).toBeInstanceOf(IdentityResolver)
    })
  })
})

// ============================================================================
// ANONYMOUS USER TRACKING
// ============================================================================

describe('Anonymous User Tracking', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = createResolver()
  })

  describe('identify with anonymousId only', () => {
    it('should create identity for anonymous user', () => {
      const result = resolver.identify({
        anonymousId: 'anon_123',
      })

      expect(result.identity).toBeDefined()
      expect(result.identity.anonymousIds).toContain('anon_123')
      expect(result.identity.userIds).toHaveLength(0)
      expect(result.identity.canonicalId).toBeNull()
    })

    it('should track traits for anonymous user', () => {
      const result = resolver.identify({
        anonymousId: 'anon_123',
        traits: {
          referrer: 'google.com',
          landingPage: '/pricing',
        },
      })

      expect(result.identity.traits).toMatchObject({
        referrer: 'google.com',
        landingPage: '/pricing',
      })
    })

    it('should update traits on subsequent identifies', () => {
      resolver.identify({
        anonymousId: 'anon_123',
        traits: { step: 1 },
      })

      resolver.identify({
        anonymousId: 'anon_123',
        traits: { step: 2, newTrait: 'value' },
      })

      const identity = resolver.resolve('anon_123')
      expect(identity?.traits).toMatchObject({
        step: 2,
        newTrait: 'value',
      })
    })

    it('should reuse existing identity for same anonymousId', () => {
      const result1 = resolver.identify({ anonymousId: 'anon_123' })
      const result2 = resolver.identify({ anonymousId: 'anon_123' })

      expect(resolver.areSameUser('anon_123', 'anon_123')).toBe(true)
      expect(result1.identity.createdAt).toEqual(result2.identity.createdAt)
    })

    it('should create separate identities for different anonymousIds', () => {
      resolver.identify({ anonymousId: 'anon_123' })
      resolver.identify({ anonymousId: 'anon_456' })

      expect(resolver.areSameUser('anon_123', 'anon_456')).toBe(false)
    })
  })

  describe('max anonymous IDs limit', () => {
    it('should enforce maxAnonymousIds limit', () => {
      const resolver = createResolver({ maxAnonymousIds: 3 })

      // Create identity with first anonymous ID
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_1' })

      // Add more anonymous IDs
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_2' })
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_3' })
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_4' })

      const identity = resolver.resolve('user_1')
      expect(identity?.anonymousIds).toHaveLength(3)
      // Oldest should be removed
      expect(identity?.anonymousIds).not.toContain('anon_1')
      expect(identity?.anonymousIds).toContain('anon_4')
    })
  })
})

// ============================================================================
// AUTHENTICATED USER IDENTIFICATION
// ============================================================================

describe('Authenticated User Identification', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = createResolver()
  })

  describe('identify with userId', () => {
    it('should create identity for authenticated user', () => {
      const result = resolver.identify({
        userId: 'user_123',
      })

      expect(result.identity.userIds).toContain('user_123')
      expect(result.identity.canonicalId).toBe('user_123')
    })

    it('should track traits for authenticated user', () => {
      const result = resolver.identify({
        userId: 'user_123',
        traits: {
          email: 'john@example.com',
          name: 'John Doe',
          plan: 'premium',
        },
      })

      expect(result.identity.traits).toMatchObject({
        email: 'john@example.com',
        name: 'John Doe',
        plan: 'premium',
      })
    })

    it('should resolve identity by userId', () => {
      resolver.identify({
        userId: 'user_123',
        traits: { name: 'John' },
      })

      const identity = resolver.resolve('user_123')
      expect(identity).toBeDefined()
      expect(identity?.traits.name).toBe('John')
    })
  })

  describe('identify with both userId and anonymousId', () => {
    it('should link anonymous to user', () => {
      const result = resolver.identify({
        userId: 'user_123',
        anonymousId: 'anon_456',
      })

      expect(result.identity.userIds).toContain('user_123')
      expect(result.identity.anonymousIds).toContain('anon_456')
      expect(resolver.areSameUser('user_123', 'anon_456')).toBe(true)
    })

    it('should merge pre-existing anonymous identity', () => {
      // First: anonymous user browses site
      resolver.identify({
        anonymousId: 'anon_456',
        traits: { referrer: 'google.com' },
      })

      // Later: user signs up
      const result = resolver.identify({
        userId: 'user_123',
        anonymousId: 'anon_456',
        traits: { name: 'John' },
      })

      // Should have both traits
      expect(result.identity.traits).toMatchObject({
        referrer: 'google.com',
        name: 'John',
      })
    })
  })

  describe('additional identifiers', () => {
    it('should track email', () => {
      const result = resolver.identify({
        userId: 'user_123',
        identifiers: {
          email: 'john@example.com',
        },
      })

      expect(result.identity.emails).toContain('john@example.com')
    })

    it('should normalize email to lowercase', () => {
      const result = resolver.identify({
        userId: 'user_123',
        identifiers: {
          email: 'John@Example.COM',
        },
      })

      expect(result.identity.emails).toContain('john@example.com')
    })

    it('should track phone', () => {
      const result = resolver.identify({
        userId: 'user_123',
        identifiers: {
          phone: '+1 (555) 123-4567',
        },
      })

      // Phone should be normalized (digits only)
      expect(result.identity.phones).toContain('15551234567')
    })

    it('should track device ID', () => {
      const result = resolver.identify({
        userId: 'user_123',
        identifiers: {
          deviceId: 'device_abc123',
        },
      })

      expect(result.identity.deviceIds).toContain('device_abc123')
    })

    it('should track custom identifiers', () => {
      const result = resolver.identify({
        userId: 'user_123',
        identifiers: {
          stripeCustomerId: 'cus_abc123',
          hubspotContactId: 'contact_xyz',
        },
      })

      expect(result.identity.customIds.get('stripeCustomerId')).toContain(
        'cus_abc123'
      )
      expect(result.identity.customIds.get('hubspotContactId')).toContain(
        'contact_xyz'
      )
    })
  })
})

// ============================================================================
// PROFILE MERGING
// ============================================================================

describe('Profile Merging', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = createResolver()
  })

  describe('alias operation', () => {
    it('should alias anonymous to user ID', () => {
      const result = resolver.alias({
        previousId: 'anon_123',
        userId: 'user_456',
      })

      expect(result.identity.anonymousIds).toContain('anon_123')
      expect(result.identity.userIds).toContain('user_456')
      expect(result.identity.canonicalId).toBe('user_456')
    })

    it('should require previousId', () => {
      expect(() =>
        resolver.alias({
          previousId: '',
          userId: 'user_456',
        })
      ).toThrow('previousId and userId are required')
    })

    it('should require userId', () => {
      expect(() =>
        resolver.alias({
          previousId: 'anon_123',
          userId: '',
        })
      ).toThrow('previousId and userId are required')
    })

    it('should merge traits when aliasing', () => {
      // Anonymous user has some traits
      resolver.identify({
        anonymousId: 'anon_123',
        traits: { referrer: 'google.com', utm_source: 'ads' },
      })

      // Alias to user
      resolver.alias({
        previousId: 'anon_123',
        userId: 'user_456',
      })

      const identity = resolver.resolve('user_456')
      expect(identity?.traits).toMatchObject({
        referrer: 'google.com',
        utm_source: 'ads',
      })
    })

    it('should merge two existing identities on alias', () => {
      // Create two separate identities
      resolver.identify({
        anonymousId: 'anon_123',
        traits: { source: 'organic' },
      })

      resolver.identify({
        userId: 'user_456',
        traits: { plan: 'premium' },
      })

      // Alias them together
      const result = resolver.alias({
        previousId: 'anon_123',
        userId: 'user_456',
      })

      expect(result.merged).toBe(true)
      expect(result.identity.traits).toMatchObject({
        source: 'organic',
        plan: 'premium',
      })
    })
  })

  describe('automatic merge on identify', () => {
    it('should merge when anonymous ID already belongs to different user', () => {
      // First user uses anonymous ID
      resolver.identify({
        userId: 'user_A',
        anonymousId: 'shared_anon',
        traits: { name: 'Alice' },
      })

      // Second user claims same anonymous ID (should merge)
      const result = resolver.identify({
        userId: 'user_B',
        anonymousId: 'shared_anon',
        traits: { name: 'Bob' },
      })

      // Should be merged
      expect(result.merged).toBe(true)
      expect(result.identity.userIds).toContain('user_A')
      expect(result.identity.userIds).toContain('user_B')
    })
  })

  describe('merge record tracking', () => {
    it('should track merge history', () => {
      resolver.identify({
        anonymousId: 'anon_123',
        traits: { step: 1 },
      })

      resolver.identify({
        userId: 'user_456',
        traits: { step: 2 },
      })

      const result = resolver.alias({
        previousId: 'anon_123',
        userId: 'user_456',
      })

      expect(result.identity.mergeHistory.length).toBeGreaterThan(0)
      const lastMerge = result.identity.mergeHistory.at(-1)!
      expect(lastMerge.mergeType).toBe('alias')
      expect(lastMerge.inheritedTraits).toBeDefined()
    })

    it('should call onMerge callback', () => {
      const onMerge = vi.fn()
      const resolver = createResolver({ onMerge })

      resolver.identify({ anonymousId: 'anon_123' })
      resolver.identify({ userId: 'user_456' })
      resolver.alias({ previousId: 'anon_123', userId: 'user_456' })

      expect(onMerge).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// IDENTITY GRAPH MANAGEMENT
// ============================================================================

describe('Identity Graph Management', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = createResolver()
  })

  describe('getLinkedIds', () => {
    it('should return all linked identifiers', () => {
      resolver.identify({
        userId: 'user_123',
        anonymousId: 'anon_456',
        identifiers: {
          email: 'john@example.com',
          phone: '5551234567',
          deviceId: 'device_abc',
        },
      })

      const linkedIds = resolver.getLinkedIds('user_123')

      expect(linkedIds).toContain('user_123')
      expect(linkedIds).toContain('anon_456')
      expect(linkedIds).toContain('john@example.com')
      expect(linkedIds).toContain('5551234567')
      expect(linkedIds).toContain('device_abc')
    })

    it('should return empty array for unknown identifier', () => {
      const linkedIds = resolver.getLinkedIds('unknown_id')
      expect(linkedIds).toHaveLength(0)
    })
  })

  describe('areSameUser', () => {
    it('should return true for same identity', () => {
      resolver.identify({
        userId: 'user_123',
        anonymousId: 'anon_456',
      })

      expect(resolver.areSameUser('user_123', 'anon_456')).toBe(true)
    })

    it('should return false for different identities', () => {
      resolver.identify({ userId: 'user_A' })
      resolver.identify({ userId: 'user_B' })

      expect(resolver.areSameUser('user_A', 'user_B')).toBe(false)
    })

    it('should return false for unknown identifiers', () => {
      expect(resolver.areSameUser('unknown_1', 'unknown_2')).toBe(false)
    })
  })

  describe('getCanonicalUserId', () => {
    it('should return canonical user ID for any identifier', () => {
      resolver.identify({
        userId: 'user_123',
        anonymousId: 'anon_456',
      })

      expect(resolver.getCanonicalUserId('user_123')).toBe('user_123')
      expect(resolver.getCanonicalUserId('anon_456')).toBe('user_123')
    })

    it('should return null for anonymous-only identities', () => {
      resolver.identify({ anonymousId: 'anon_123' })

      expect(resolver.getCanonicalUserId('anon_123')).toBeNull()
    })

    it('should return null for unknown identifiers', () => {
      expect(resolver.getCanonicalUserId('unknown')).toBeNull()
    })
  })

  describe('getAnonymousIds', () => {
    it('should return all anonymous IDs for a user', () => {
      resolver.identify({ userId: 'user_123', anonymousId: 'anon_1' })
      resolver.identify({ userId: 'user_123', anonymousId: 'anon_2' })
      resolver.identify({ userId: 'user_123', anonymousId: 'anon_3' })

      const anonIds = resolver.getAnonymousIds('user_123')

      expect(anonIds).toContain('anon_1')
      expect(anonIds).toContain('anon_2')
      expect(anonIds).toContain('anon_3')
    })

    it('should return empty array for user with no anonymous IDs', () => {
      resolver.identify({ userId: 'user_123' })

      const anonIds = resolver.getAnonymousIds('user_123')
      expect(anonIds).toHaveLength(0)
    })
  })

  describe('manual merge', () => {
    it('should merge two identities manually', () => {
      resolver.identify({ userId: 'user_A', traits: { a: 1 } })
      resolver.identify({ userId: 'user_B', traits: { b: 2 } })

      const mergeRecord = resolver.merge('user_A', 'user_B')

      expect(mergeRecord).not.toBeNull()
      expect(resolver.areSameUser('user_A', 'user_B')).toBe(true)

      const identity = resolver.resolve('user_B')
      expect(identity?.traits).toMatchObject({ a: 1, b: 2 })
    })

    it('should return null when already same identity', () => {
      resolver.identify({ userId: 'user_A', anonymousId: 'anon_123' })

      const mergeRecord = resolver.merge('user_A', 'anon_123')
      expect(mergeRecord).toBeNull()
    })

    it('should return null for unknown identifiers', () => {
      const mergeRecord = resolver.merge('unknown_1', 'unknown_2')
      expect(mergeRecord).toBeNull()
    })
  })

  describe('getStats', () => {
    it('should return identity graph statistics', () => {
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_1' })
      resolver.identify({ userId: 'user_1', anonymousId: 'anon_2' })
      resolver.identify({ userId: 'user_2', anonymousId: 'anon_3' })
      resolver.identify({ anonymousId: 'anon_4' }) // Anonymous only

      const stats = resolver.getStats()

      expect(stats.totalIdentities).toBe(3)
      expect(stats.totalNodes).toBeGreaterThan(0)
      expect(stats.averageAnonymousIdsPerUser).toBe(1.5) // 3 anon / 2 users
    })
  })
})

// ============================================================================
// AUTO-MERGE ON EMAIL/PHONE
// ============================================================================

describe('Auto-Merge on Email', () => {
  it('should auto-merge when enabled and email matches', () => {
    const resolver = createResolver({ autoMergeOnEmail: true })

    // First user with email
    resolver.identify({
      userId: 'user_A',
      identifiers: { email: 'shared@example.com' },
      traits: { name: 'Alice' },
    })

    // Second user with same email
    const result = resolver.identify({
      userId: 'user_B',
      identifiers: { email: 'shared@example.com' },
      traits: { plan: 'premium' },
    })

    expect(result.merged).toBe(true)
    expect(result.identity.userIds).toContain('user_A')
    expect(result.identity.userIds).toContain('user_B')
    expect(result.identity.traits).toMatchObject({
      name: 'Alice',
      plan: 'premium',
    })
  })

  it('should not auto-merge when disabled', () => {
    const resolver = createResolver({ autoMergeOnEmail: false })

    resolver.identify({
      userId: 'user_A',
      identifiers: { email: 'shared@example.com' },
    })

    const result = resolver.identify({
      userId: 'user_B',
      identifiers: { email: 'shared@example.com' },
    })

    expect(result.merged).toBe(false)
    expect(resolver.areSameUser('user_A', 'user_B')).toBe(false)
  })
})

describe('Auto-Merge on Phone', () => {
  it('should auto-merge when enabled and phone matches', () => {
    const resolver = createResolver({ autoMergeOnPhone: true })

    resolver.identify({
      userId: 'user_A',
      identifiers: { phone: '+1-555-123-4567' },
      traits: { name: 'Alice' },
    })

    const result = resolver.identify({
      userId: 'user_B',
      identifiers: { phone: '15551234567' }, // Same phone, different format
      traits: { plan: 'premium' },
    })

    expect(result.merged).toBe(true)
    expect(result.identity.userIds).toContain('user_A')
    expect(result.identity.userIds).toContain('user_B')
  })
})

// ============================================================================
// TRAIT MERGE STRATEGIES
// ============================================================================

describe('Trait Merge Strategies', () => {
  describe('newest strategy (default)', () => {
    it('should use newest values', () => {
      const resolver = createResolver({ traitMergeStrategy: 'newest' })

      resolver.identify({
        userId: 'user_123',
        traits: { name: 'Old Name', oldTrait: 'keep' },
      })

      resolver.identify({
        userId: 'user_123',
        traits: { name: 'New Name', newTrait: 'add' },
      })

      const identity = resolver.resolve('user_123')
      expect(identity?.traits).toMatchObject({
        name: 'New Name',
        oldTrait: 'keep',
        newTrait: 'add',
      })
    })
  })

  describe('oldest strategy', () => {
    it('should keep oldest values', () => {
      const resolver = createResolver({ traitMergeStrategy: 'oldest' })

      resolver.identify({
        userId: 'user_123',
        traits: { name: 'First Name', firstTrait: 'keep' },
      })

      resolver.identify({
        userId: 'user_123',
        traits: { name: 'Second Name', secondTrait: 'add' },
      })

      const identity = resolver.resolve('user_123')
      expect(identity?.traits).toMatchObject({
        name: 'First Name',
        firstTrait: 'keep',
        secondTrait: 'add',
      })
    })
  })

  describe('merge strategy', () => {
    it('should deep merge arrays', () => {
      const resolver = createResolver({ traitMergeStrategy: 'merge' })

      resolver.identify({
        userId: 'user_123',
        traits: { tags: ['a', 'b'] },
      })

      resolver.identify({
        userId: 'user_123',
        traits: { tags: ['b', 'c'] },
      })

      const identity = resolver.resolve('user_123')
      // Should deduplicate
      expect(identity?.traits.tags).toEqual(['a', 'b', 'c'])
    })

    it('should deep merge objects', () => {
      const resolver = createResolver({ traitMergeStrategy: 'merge' })

      resolver.identify({
        userId: 'user_123',
        traits: {
          address: { city: 'NYC', zip: '10001' },
        },
      })

      resolver.identify({
        userId: 'user_123',
        traits: {
          address: { city: 'LA', state: 'CA' },
        },
      })

      const identity = resolver.resolve('user_123')
      expect(identity?.traits.address).toMatchObject({
        city: 'LA', // newest for primitives within objects
        zip: '10001',
        state: 'CA',
      })
    })
  })
})

// ============================================================================
// TRAITS OPERATIONS
// ============================================================================

describe('Traits Operations', () => {
  let resolver: IdentityResolver

  beforeEach(() => {
    resolver = createResolver()
  })

  describe('getTraits', () => {
    it('should return traits for identifier', () => {
      resolver.identify({
        userId: 'user_123',
        traits: { name: 'John', plan: 'premium' },
      })

      const traits = resolver.getTraits('user_123')
      expect(traits).toMatchObject({ name: 'John', plan: 'premium' })
    })

    it('should return undefined for unknown identifier', () => {
      const traits = resolver.getTraits('unknown')
      expect(traits).toBeUndefined()
    })
  })

  describe('updateTraits', () => {
    it('should update traits for existing identity', () => {
      resolver.identify({
        userId: 'user_123',
        traits: { name: 'John' },
      })

      const success = resolver.updateTraits('user_123', { plan: 'enterprise' })

      expect(success).toBe(true)
      expect(resolver.getTraits('user_123')).toMatchObject({
        name: 'John',
        plan: 'enterprise',
      })
    })

    it('should return false for unknown identifier', () => {
      const success = resolver.updateTraits('unknown', { name: 'John' })
      expect(success).toBe(false)
    })
  })
})

// ============================================================================
// CLEANUP AND EXPIRATION
// ============================================================================

describe('Cleanup and Expiration', () => {
  it('should clean up expired anonymous IDs', () => {
    vi.useFakeTimers()

    const resolver = createResolver({
      anonymousIdTTL: 1000, // 1 second TTL for testing
    })

    // Create identity with anonymous ID
    resolver.identify({ userId: 'user_123', anonymousId: 'anon_old' })

    // Advance time past TTL
    vi.advanceTimersByTime(2000)

    // Add new anonymous ID (updates lastSeen on identity)
    resolver.identify({ userId: 'user_123', anonymousId: 'anon_new' })

    // Run cleanup
    const cleaned = resolver.cleanupExpiredAnonymousIds()

    expect(cleaned).toBe(1)
    expect(resolver.getAnonymousIds('user_123')).not.toContain('anon_old')
    expect(resolver.getAnonymousIds('user_123')).toContain('anon_new')

    vi.useRealTimers()
  })
})

// ============================================================================
// EXPORT/IMPORT
// ============================================================================

describe('Export/Import', () => {
  it('should export identity for serialization', () => {
    const resolver = createResolver()

    resolver.identify({
      userId: 'user_123',
      anonymousId: 'anon_456',
      traits: { name: 'John' },
      identifiers: {
        email: 'john@example.com',
        stripeId: 'cus_abc',
      },
    })

    const exported = resolver.exportIdentity('user_123')

    expect(exported).toBeDefined()
    expect((exported as ResolvedIdentity).userIds).toContain('user_123')
    expect((exported as ResolvedIdentity).anonymousIds).toContain('anon_456')
    expect((exported as ResolvedIdentity).emails).toContain('john@example.com')
    // customIds should be converted to plain object
    expect((exported as { customIds: { stripeId: string[] } }).customIds).toHaveProperty('stripeId')
  })

  it('should import previously exported identity', () => {
    const resolver1 = createResolver()

    resolver1.identify({
      userId: 'user_123',
      anonymousId: 'anon_456',
      traits: { name: 'John' },
    })

    const exported = resolver1.exportIdentity('user_123')!

    // Import into new resolver
    const resolver2 = createResolver()
    resolver2.importIdentity(exported)

    // Should be able to resolve
    const identity = resolver2.resolve('user_123')
    expect(identity).toBeDefined()
    expect(identity?.traits.name).toBe('John')
    expect(identity?.anonymousIds).toContain('anon_456')
  })
})

// ============================================================================
// CALLBACKS
// ============================================================================

describe('Callbacks', () => {
  it('should call onIdentityCreated callback', () => {
    const onIdentityCreated = vi.fn()
    const resolver = createResolver({ onIdentityCreated })

    resolver.identify({ userId: 'user_123' })

    expect(onIdentityCreated).toHaveBeenCalledTimes(1)
    expect(onIdentityCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['user_123'],
      })
    )
  })

  it('should not call onIdentityCreated for existing identity', () => {
    const onIdentityCreated = vi.fn()
    const resolver = createResolver({ onIdentityCreated })

    resolver.identify({ userId: 'user_123' })
    resolver.identify({ userId: 'user_123', traits: { updated: true } })

    expect(onIdentityCreated).toHaveBeenCalledTimes(1)
  })

  it('should call onMerge callback when identities merge', () => {
    const onMerge = vi.fn()
    const resolver = createResolver({ onMerge, autoMergeOnEmail: true })

    resolver.identify({
      userId: 'user_A',
      identifiers: { email: 'shared@example.com' },
    })

    resolver.identify({
      userId: 'user_B',
      identifiers: { email: 'shared@example.com' },
    })

    expect(onMerge).toHaveBeenCalled()
    expect(onMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        mergeType: 'auto',
      })
    )
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('Error Handling', () => {
  it('should require userId or anonymousId for identify', () => {
    const resolver = createResolver()

    expect(() =>
      resolver.identify({} as IdentifyInput)
    ).toThrow('userId or anonymousId is required')
  })

  it('should handle resolve for non-existent identifier', () => {
    const resolver = createResolver()

    const identity = resolver.resolve('non_existent')
    expect(identity).toBeUndefined()
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty traits object', () => {
    const resolver = createResolver()

    const result = resolver.identify({
      userId: 'user_123',
      traits: {},
    })

    expect(result.identity).toBeDefined()
    expect(result.identity.traits).toEqual({})
  })

  it('should handle undefined traits', () => {
    const resolver = createResolver()

    const result = resolver.identify({
      userId: 'user_123',
    })

    expect(result.identity).toBeDefined()
    expect(result.identity.traits).toEqual({})
  })

  it('should handle multiple identifies in sequence', () => {
    const resolver = createResolver()

    // Simulate user journey
    resolver.identify({ anonymousId: 'anon_1', traits: { step: 'landing' } })
    resolver.identify({ anonymousId: 'anon_1', traits: { step: 'pricing' } })
    resolver.identify({ anonymousId: 'anon_1', traits: { step: 'signup' } })
    resolver.identify({
      userId: 'user_123',
      anonymousId: 'anon_1',
      traits: { step: 'dashboard' },
    })

    const identity = resolver.resolve('user_123')
    expect(identity?.traits.step).toBe('dashboard')
    expect(identity?.anonymousIds).toContain('anon_1')
  })

  it('should handle re-identifying same user from different anonymous IDs', () => {
    const resolver = createResolver()

    // User on device 1
    resolver.identify({ anonymousId: 'device_1_anon', traits: { device: 1 } })
    resolver.identify({
      userId: 'user_123',
      anonymousId: 'device_1_anon',
    })

    // User on device 2
    resolver.identify({ anonymousId: 'device_2_anon', traits: { device: 2 } })
    resolver.identify({
      userId: 'user_123',
      anonymousId: 'device_2_anon',
    })

    // Both should be linked
    expect(resolver.areSameUser('device_1_anon', 'device_2_anon')).toBe(true)

    const identity = resolver.resolve('user_123')
    expect(identity?.anonymousIds).toContain('device_1_anon')
    expect(identity?.anonymousIds).toContain('device_2_anon')
  })
})
