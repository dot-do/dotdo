/**
 * [SDK-7] Set Operations - TDD RED Phase
 *
 * Comprehensive tests for graph set operations:
 * - Intersect: Find mutual connections between users
 * - Union: Combine multiple traversal results
 * - Except: Exclude already-known nodes from results
 *
 * These tests are designed to fail because the production implementation
 * does not yet exist. This is the RED phase of TDD.
 *
 * @see /db/compat/sql/clickhouse/spikes/graph-sdk.ts for spike implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import from production module path (does not exist yet - RED phase)
import {
  createGraph,
  Graph,
  GraphNode,
  Traversal,
  MagicTraversal,
} from '../src/set-operations'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create a standardized social graph for testing
 * Returns graph with users and their follow relationships
 */
function createSocialGraph() {
  const graph = createGraph({ namespace: 'test' })

  // Create a social network:
  //
  //   alice --follows--> bob
  //   alice --follows--> carol
  //   alice --follows--> dave
  //
  //   bob --follows--> carol
  //   bob --follows--> eve
  //   bob --follows--> frank
  //
  //   carol --follows--> alice  (mutual with alice)
  //   carol --follows--> eve
  //   carol --follows--> grace
  //
  //   dave --follows--> eve
  //   dave --follows--> hank
  //
  //   eve --follows--> alice
  //   eve --follows--> grace
  //
  //   frank --follows--> grace
  //   frank --follows--> hank
  //
  //   grace --follows--> hank
  //
  // This creates various interesting set operation scenarios

  const now = Date.now()

  graph.addRelationships([
    // Alice's follows
    { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: now },
    { id: 'rel-2', type: 'follows', from: 'alice', to: 'carol', createdAt: now },
    { id: 'rel-3', type: 'follows', from: 'alice', to: 'dave', createdAt: now },

    // Bob's follows
    { id: 'rel-4', type: 'follows', from: 'bob', to: 'carol', createdAt: now },
    { id: 'rel-5', type: 'follows', from: 'bob', to: 'eve', createdAt: now },
    { id: 'rel-6', type: 'follows', from: 'bob', to: 'frank', createdAt: now },

    // Carol's follows
    { id: 'rel-7', type: 'follows', from: 'carol', to: 'alice', createdAt: now },
    { id: 'rel-8', type: 'follows', from: 'carol', to: 'eve', createdAt: now },
    { id: 'rel-9', type: 'follows', from: 'carol', to: 'grace', createdAt: now },

    // Dave's follows
    { id: 'rel-10', type: 'follows', from: 'dave', to: 'eve', createdAt: now },
    { id: 'rel-11', type: 'follows', from: 'dave', to: 'hank', createdAt: now },

    // Eve's follows
    { id: 'rel-12', type: 'follows', from: 'eve', to: 'alice', createdAt: now },
    { id: 'rel-13', type: 'follows', from: 'eve', to: 'grace', createdAt: now },

    // Frank's follows
    { id: 'rel-14', type: 'follows', from: 'frank', to: 'grace', createdAt: now },
    { id: 'rel-15', type: 'follows', from: 'frank', to: 'hank', createdAt: now },

    // Grace's follows
    { id: 'rel-16', type: 'follows', from: 'grace', to: 'hank', createdAt: now },
  ])

  return graph
}

// ============================================================================
// INTERSECT OPERATION TESTS
// ============================================================================

describe('Set Operations: Intersect', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Basic Intersect', () => {
    it('should find mutual friends between two users', async () => {
      // Alice follows: bob, carol, dave
      // Bob follows: carol, eve, frank
      // Mutual: carol
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const mutual = await alice.$.follows.intersect(bob.$.follows).ids()

      expect(mutual).toHaveLength(1)
      expect(mutual).toContain('carol')
    })

    it('should return empty when no mutual friends exist', async () => {
      // Alice follows: bob, carol, dave
      // Frank follows: grace, hank
      // No overlap
      const alice = graph.node('alice')
      const frank = graph.node('frank')

      const mutual = await alice.$.follows.intersect(frank.$.follows).ids()

      expect(mutual).toHaveLength(0)
    })

    it('should handle intersect with multiple common friends', async () => {
      // Bob follows: carol, eve, frank
      // Carol follows: alice, eve, grace
      // Mutual: eve
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      const mutual = await bob.$.follows.intersect(carol.$.follows).ids()

      expect(mutual).toHaveLength(1)
      expect(mutual).toContain('eve')
    })

    it('should return nodes not just IDs when using nodes()', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const mutual = await alice.$.follows.intersect(bob.$.follows).nodes()

      expect(mutual).toHaveLength(1)
      expect(mutual[0]).toHaveProperty('id', 'carol')
    })
  })

  describe('Intersect with Chained Traversals', () => {
    it('should intersect after chained traversals', async () => {
      // Alice's friends' friends intersected with Bob's friends
      // Alice -> bob, carol, dave -> (carol, eve, frank) U (alice, eve, grace) U (eve, hank)
      // Bob follows: carol, eve, frank
      // Intersection should include common nodes
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const result = await alice.$.follows.follows.intersect(bob.$.follows).ids()

      // Alice's FoF: carol, eve, frank, alice, grace, hank
      // Bob's follows: carol, eve, frank
      // Intersection: carol, eve, frank
      expect(result).toContain('carol')
      expect(result).toContain('eve')
      expect(result).toContain('frank')
    })

    it('should handle intersect between two chained traversals', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      // Alice's FoF intersect Bob's FoF
      const result = await alice.$.follows.follows
        .intersect(bob.$.follows.follows)
        .ids()

      // Both should have overlapping FoF
      expect(result.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Intersect Order Independence', () => {
    it('should return same results regardless of order: a.intersect(b) === b.intersect(a)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const mutual1 = await alice.$.follows.intersect(bob.$.follows).ids()
      const mutual2 = await bob.$.follows.intersect(alice.$.follows).ids()

      expect(mutual1.sort()).toEqual(mutual2.sort())
    })

    it('should return same count regardless of order', async () => {
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      const count1 = await bob.$.follows.intersect(carol.$.follows).count()
      const count2 = await carol.$.follows.intersect(bob.$.follows).count()

      expect(count1).toBe(count2)
    })
  })

  describe('Self Intersect', () => {
    it('should return same set when intersecting with self', async () => {
      const alice = graph.node('alice')

      const friends = await alice.$.follows.ids()
      const selfIntersect = await alice.$.follows.intersect(alice.$.follows).ids()

      expect(selfIntersect.sort()).toEqual(friends.sort())
    })

    it('should handle self intersect with count()', async () => {
      const alice = graph.node('alice')

      const count = await alice.$.follows.count()
      const selfIntersectCount = await alice.$.follows.intersect(alice.$.follows).count()

      expect(selfIntersectCount).toBe(count)
    })
  })
})

// ============================================================================
// UNION OPERATION TESTS
// ============================================================================

describe('Set Operations: Union', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Basic Union', () => {
    it('should combine friends of two users', async () => {
      // Alice follows: bob, carol, dave
      // Frank follows: grace, hank
      // Union: bob, carol, dave, grace, hank
      const alice = graph.node('alice')
      const frank = graph.node('frank')

      const combined = await alice.$.follows.union(frank.$.follows).ids()

      expect(combined).toHaveLength(5)
      expect(combined).toContain('bob')
      expect(combined).toContain('carol')
      expect(combined).toContain('dave')
      expect(combined).toContain('grace')
      expect(combined).toContain('hank')
    })

    it('should deduplicate overlapping friends', async () => {
      // Alice follows: bob, carol, dave
      // Bob follows: carol, eve, frank
      // Union (deduplicated): bob, carol, dave, eve, frank
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const combined = await alice.$.follows.union(bob.$.follows).ids()

      expect(combined).toHaveLength(5)
      expect(combined).toContain('bob')
      expect(combined).toContain('carol')
      expect(combined).toContain('dave')
      expect(combined).toContain('eve')
      expect(combined).toContain('frank')
    })

    it('should return all when no overlap', async () => {
      // Alice follows: bob, carol, dave
      // Grace follows: hank
      const alice = graph.node('alice')
      const grace = graph.node('grace')

      const combined = await alice.$.follows.union(grace.$.follows).ids()

      expect(combined).toHaveLength(4)
      expect(combined).toContain('bob')
      expect(combined).toContain('carol')
      expect(combined).toContain('dave')
      expect(combined).toContain('hank')
    })
  })

  describe('Union with Empty Sets', () => {
    it('should return original set when union with empty', async () => {
      // Hank follows no one
      const alice = graph.node('alice')
      const hank = graph.node('hank')

      const friends = await alice.$.follows.ids()
      const combined = await alice.$.follows.union(hank.$.follows).ids()

      expect(combined.sort()).toEqual(friends.sort())
    })

    it('should return other set when self is empty', async () => {
      const hank = graph.node('hank')
      const alice = graph.node('alice')

      const aliceFriends = await alice.$.follows.ids()
      const combined = await hank.$.follows.union(alice.$.follows).ids()

      expect(combined.sort()).toEqual(aliceFriends.sort())
    })

    it('should return empty when both are empty', async () => {
      const hank = graph.node('hank')
      const isolated = graph.node('isolated-user')

      const combined = await hank.$.follows.union(isolated.$.follows).ids()

      expect(combined).toHaveLength(0)
    })
  })

  describe('Union Order Independence', () => {
    it('should return same results regardless of order: a.union(b) === b.union(a)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const union1 = await alice.$.follows.union(bob.$.follows).ids()
      const union2 = await bob.$.follows.union(alice.$.follows).ids()

      expect(union1.sort()).toEqual(union2.sort())
    })
  })

  describe('Self Union', () => {
    it('should return same set when union with self', async () => {
      const alice = graph.node('alice')

      const friends = await alice.$.follows.ids()
      const selfUnion = await alice.$.follows.union(alice.$.follows).ids()

      expect(selfUnion.sort()).toEqual(friends.sort())
    })
  })
})

// ============================================================================
// EXCEPT OPERATION TESTS
// ============================================================================

describe('Set Operations: Except', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Basic Except', () => {
    it('should exclude common friends from result', async () => {
      // Alice follows: bob, carol, dave
      // Bob follows: carol, eve, frank
      // Alice.except(Bob) = bob, dave (carol excluded)
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const unique = await alice.$.follows.except(bob.$.follows).ids()

      expect(unique).toHaveLength(2)
      expect(unique).toContain('bob')
      expect(unique).toContain('dave')
      expect(unique).not.toContain('carol')
    })

    it('should return all when no overlap', async () => {
      // Alice follows: bob, carol, dave
      // Grace follows: hank
      const alice = graph.node('alice')
      const grace = graph.node('grace')

      const unique = await alice.$.follows.except(grace.$.follows).ids()

      expect(unique).toHaveLength(3)
      expect(unique).toContain('bob')
      expect(unique).toContain('carol')
      expect(unique).toContain('dave')
    })

    it('should return empty when all excluded', async () => {
      // Self except self = empty
      const alice = graph.node('alice')

      const unique = await alice.$.follows.except(alice.$.follows).ids()

      expect(unique).toHaveLength(0)
    })
  })

  describe('FoF Except Friends Pattern (Friend Suggestions)', () => {
    it('should find friends-of-friends not already friends', async () => {
      // Alice follows: bob, carol, dave
      // Alice's FoF: carol, eve, frank, alice, eve, grace, eve, hank
      // Unique FoF (not direct friends): eve, frank, alice, grace, hank
      const alice = graph.node('alice')

      const suggestions = await alice.$.follows.follows
        .except(alice.$.follows)
        .ids()

      expect(suggestions).not.toContain('bob')
      expect(suggestions).not.toContain('carol')
      expect(suggestions).not.toContain('dave')
      expect(suggestions).toContain('eve')
      expect(suggestions).toContain('frank')
      expect(suggestions).toContain('grace')
      expect(suggestions).toContain('hank')
    })

    it('should exclude self from friend suggestions', async () => {
      const alice = graph.node('alice')

      const suggestionsWithSelf = await alice.$.follows.follows
        .except(alice.$.follows)
        .ids()

      // Alice appears in FoF because carol follows alice
      // But we might want to exclude self as well
      expect(suggestionsWithSelf).toContain('alice')

      // To exclude self, chain another except
      const suggestionsWithoutSelf = await alice.$.follows.follows
        .except(alice.$.follows)
        .except(graph.from('alice'))
        .ids()

      expect(suggestionsWithoutSelf).not.toContain('alice')
    })
  })

  describe('Except with Array', () => {
    it('should accept array of IDs to exclude', async () => {
      const alice = graph.node('alice')

      // Exclude specific users by ID array
      const filtered = await alice.$.follows
        .except(['bob', 'carol'])
        .ids()

      expect(filtered).toHaveLength(1)
      expect(filtered).toContain('dave')
      expect(filtered).not.toContain('bob')
      expect(filtered).not.toContain('carol')
    })

    it('should accept single ID string as shorthand', async () => {
      const alice = graph.node('alice')

      const filtered = await alice.$.follows
        .except(['bob'])
        .ids()

      expect(filtered).toHaveLength(2)
      expect(filtered).not.toContain('bob')
    })
  })

  describe('Except Order Matters', () => {
    it('should return different results based on order: a.except(b) !== b.except(a)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const aExceptB = await alice.$.follows.except(bob.$.follows).ids()
      const bExceptA = await bob.$.follows.except(alice.$.follows).ids()

      // Alice.except(Bob) = bob, dave
      // Bob.except(Alice) = eve, frank
      expect(aExceptB.sort()).not.toEqual(bExceptA.sort())
    })
  })

  describe('Except with Empty Sets', () => {
    it('should return original set when except empty', async () => {
      const alice = graph.node('alice')
      const hank = graph.node('hank')

      const friends = await alice.$.follows.ids()
      const filtered = await alice.$.follows.except(hank.$.follows).ids()

      expect(filtered.sort()).toEqual(friends.sort())
    })

    it('should return empty when self is empty', async () => {
      const hank = graph.node('hank')
      const alice = graph.node('alice')

      const filtered = await hank.$.follows.except(alice.$.follows).ids()

      expect(filtered).toHaveLength(0)
    })
  })
})

// ============================================================================
// CHAINED SET OPERATIONS TESTS
// ============================================================================

describe('Chained Set Operations', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Multiple Intersects', () => {
    it('should chain multiple intersects: a.intersect(b).intersect(c)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      // Alice follows: bob, carol, dave
      // Bob follows: carol, eve, frank
      // Carol follows: alice, eve, grace
      // (Alice intersect Bob) = carol
      // (Alice intersect Bob) intersect Carol = (carol) intersect (alice, eve, grace) = empty
      const result = await alice.$.follows
        .intersect(bob.$.follows)
        .intersect(carol.$.follows)
        .ids()

      expect(result).toHaveLength(0)
    })

    it('should handle intersect chains that produce results', async () => {
      // Create scenario where triple intersect works
      // Bob follows: carol, eve, frank
      // Carol follows: alice, eve, grace
      // Dave follows: eve, hank
      // All three follow eve!
      const bob = graph.node('bob')
      const carol = graph.node('carol')
      const dave = graph.node('dave')

      const result = await bob.$.follows
        .intersect(carol.$.follows)
        .intersect(dave.$.follows)
        .ids()

      expect(result).toHaveLength(1)
      expect(result).toContain('eve')
    })
  })

  describe('Multiple Unions', () => {
    it('should chain multiple unions: a.union(b).union(c)', async () => {
      const alice = graph.node('alice')
      const frank = graph.node('frank')
      const grace = graph.node('grace')

      // Alice follows: bob, carol, dave
      // Frank follows: grace, hank
      // Grace follows: hank
      // Union all: bob, carol, dave, grace, hank (deduplicated)
      const result = await alice.$.follows
        .union(frank.$.follows)
        .union(grace.$.follows)
        .ids()

      expect(result).toContain('bob')
      expect(result).toContain('carol')
      expect(result).toContain('dave')
      expect(result).toContain('grace')
      expect(result).toContain('hank')
    })
  })

  describe('Multiple Excepts', () => {
    it('should chain multiple excepts: a.except(b).except(c)', async () => {
      // Alice follows: bob, carol, dave
      // Except {carol} = bob, dave
      // Except {dave} = bob
      const alice = graph.node('alice')
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      // Create traversals that return specific users
      const result = await alice.$.follows
        .except(bob.$.follows) // Removes carol (common with bob)
        .except(graph.from('dave').follows) // Removes hank, eve (dave's follows)
        .ids()

      // Alice friends: bob, carol, dave
      // Except bob's friends (carol, eve, frank): bob, dave remain
      // Except dave's follows (eve, hank): no impact on bob, dave
      expect(result).toContain('bob')
      expect(result).toContain('dave')
      expect(result).not.toContain('carol')
    })
  })

  describe('Mixed Set Operations', () => {
    it('should chain intersect then union: a.intersect(b).union(c)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')
      const grace = graph.node('grace')

      // (Alice intersect Bob) union Grace
      // (carol) union (hank) = carol, hank
      const result = await alice.$.follows
        .intersect(bob.$.follows)
        .union(grace.$.follows)
        .ids()

      expect(result).toContain('carol')
      expect(result).toContain('hank')
    })

    it('should chain union then intersect: a.union(b).intersect(c)', async () => {
      const alice = graph.node('alice')
      const frank = graph.node('frank')
      const carol = graph.node('carol')

      // (Alice union Frank) intersect Carol
      // (bob, carol, dave, grace, hank) intersect (alice, eve, grace) = grace
      const result = await alice.$.follows
        .union(frank.$.follows)
        .intersect(carol.$.follows)
        .ids()

      expect(result).toContain('grace')
      expect(result).toHaveLength(1)
    })

    it('should chain except then intersect: a.except(b).intersect(c)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      // (Alice except Bob) intersect Carol
      // (bob, dave) intersect (alice, eve, grace) = empty
      const result = await alice.$.follows
        .except(bob.$.follows)
        .intersect(carol.$.follows)
        .ids()

      expect(result).toHaveLength(0)
    })

    it('should chain intersect then except: a.intersect(b).except(c)', async () => {
      // Bob follows: carol, eve, frank
      // Carol follows: alice, eve, grace
      // (Bob intersect Carol) = eve
      // Except dave.follows (eve, hank) = empty
      const bob = graph.node('bob')
      const carol = graph.node('carol')
      const dave = graph.node('dave')

      const result = await bob.$.follows
        .intersect(carol.$.follows)
        .except(dave.$.follows)
        .ids()

      // eve is in dave's follows, so excluded
      expect(result).toHaveLength(0)
    })
  })

  describe('Complex Social Patterns', () => {
    it('should find users followed by all three: alice, bob, and carol', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')
      const carol = graph.node('carol')

      const followedByAll = await alice.$.follows
        .intersect(bob.$.follows)
        .intersect(carol.$.follows)
        .ids()

      // Only carol is in alice's and bob's follows, but carol doesn't follow carol
      expect(followedByAll).toHaveLength(0)
    })

    it('should find complete friend suggestion pipeline', async () => {
      // Friend suggestions for alice:
      // 1. Get FoF
      // 2. Exclude direct friends
      // 3. Exclude self
      // 4. Intersect with friends of a popular user (for quality suggestions)
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const suggestions = await alice.$.follows.follows
        .except(alice.$.follows)
        .except(graph.from('alice'))
        .intersect(bob.$.follows.follows)
        .ids()

      // This finds FoF that are also in bob's FoF network
      expect(Array.isArray(suggestions)).toBe(true)
    })
  })
})

// ============================================================================
// SOCIAL PATTERN TESTS
// ============================================================================

describe('Social Graph Patterns', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Mutual Followers Pattern', () => {
    it('should find mutual followers: people who follow each other', async () => {
      // user.$.follows.intersect(user.$.in.follows)
      // Carol follows alice, and alice follows carol
      const carol = graph.node('carol')

      const mutualFollowers = await carol.$.follows.intersect(carol.$.in.follows).ids()

      // Carol follows: alice, eve, grace
      // Who follows Carol: alice, bob
      // Mutual: alice
      expect(mutualFollowers).toContain('alice')
    })

    it('should find no mutual followers when none exist', async () => {
      const hank = graph.node('hank')

      // Hank doesn't follow anyone but is followed by many
      const mutualFollowers = await hank.$.follows.intersect(hank.$.in.follows).ids()

      expect(mutualFollowers).toHaveLength(0)
    })
  })

  describe('Friend Suggestions Pattern', () => {
    it('should suggest FoF excluding direct friends and self', async () => {
      const alice = graph.node('alice')
      const aliceId = 'alice'

      // Full friend suggestion pattern
      const suggestions = await alice.$.follows.follows
        .except(alice.$.follows)
        .except([aliceId])
        .ids()

      // Should not include alice's direct friends
      expect(suggestions).not.toContain('bob')
      expect(suggestions).not.toContain('carol')
      expect(suggestions).not.toContain('dave')

      // Should not include self
      expect(suggestions).not.toContain('alice')

      // Should include reachable FoF
      expect(suggestions).toContain('eve')
      expect(suggestions).toContain('frank')
      expect(suggestions).toContain('grace')
      expect(suggestions).toContain('hank')
    })
  })

  describe('Common Interests Pattern', () => {
    it('should find users who follow the same people as user', async () => {
      // Find users who share follows with alice
      // This requires comparing incoming edges
      const alice = graph.node('alice')

      // Users who follow at least one person alice follows
      // alice.$.follows.in.follows gives us: people who follow (bob, carol, dave)
      // That includes: alice, bob, carol, dave, eve
      const similarUsers = await alice.$.follows.in.follows
        .except([alice.id])
        .ids()

      // Should find users who also follow bob, carol, or dave
      expect(similarUsers.length).toBeGreaterThan(0)
    })
  })

  describe('Network Expansion Pattern', () => {
    it('should find combined network of multiple users', async () => {
      // Combine networks of alice and bob
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const combinedNetwork = await alice.$.follows
        .union(bob.$.follows)
        .ids()

      // All unique people followed by either alice or bob
      expect(combinedNetwork).toContain('bob')
      expect(combinedNetwork).toContain('carol')
      expect(combinedNetwork).toContain('dave')
      expect(combinedNetwork).toContain('eve')
      expect(combinedNetwork).toContain('frank')
    })
  })

  describe('Exclusive Followers Pattern', () => {
    it('should find users who only alice follows (not bob)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const onlyAlice = await alice.$.follows.except(bob.$.follows).ids()

      // Alice follows bob, carol, dave
      // Bob follows carol, eve, frank
      // Only alice follows: bob, dave
      expect(onlyAlice).toContain('bob')
      expect(onlyAlice).toContain('dave')
      expect(onlyAlice).not.toContain('carol')
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Empty Traversals', () => {
    it('should handle intersect when first traversal is empty', async () => {
      const isolated = graph.node('isolated-user')
      const alice = graph.node('alice')

      const result = await isolated.$.follows.intersect(alice.$.follows).ids()

      expect(result).toHaveLength(0)
    })

    it('should handle intersect when second traversal is empty', async () => {
      const alice = graph.node('alice')
      const isolated = graph.node('isolated-user')

      const result = await alice.$.follows.intersect(isolated.$.follows).ids()

      expect(result).toHaveLength(0)
    })

    it('should handle union when both traversals are empty', async () => {
      const isolated1 = graph.node('isolated-1')
      const isolated2 = graph.node('isolated-2')

      const result = await isolated1.$.follows.union(isolated2.$.follows).ids()

      expect(result).toHaveLength(0)
    })
  })

  describe('Non-existent Nodes', () => {
    it('should handle intersect with non-existent node', async () => {
      const alice = graph.node('alice')
      const ghost = graph.node('non-existent')

      const result = await alice.$.follows.intersect(ghost.$.follows).ids()

      expect(result).toHaveLength(0)
    })

    it('should handle union with non-existent node', async () => {
      const alice = graph.node('alice')
      const ghost = graph.node('non-existent')

      const result = await alice.$.follows.union(ghost.$.follows).ids()
      const aliceFriends = await alice.$.follows.ids()

      expect(result.sort()).toEqual(aliceFriends.sort())
    })

    it('should handle except with non-existent node', async () => {
      const alice = graph.node('alice')
      const ghost = graph.node('non-existent')

      const result = await alice.$.follows.except(ghost.$.follows).ids()
      const aliceFriends = await alice.$.follows.ids()

      expect(result.sort()).toEqual(aliceFriends.sort())
    })
  })

  describe('Large Result Sets', () => {
    it('should handle intersect with large traversal results', async () => {
      // Create a graph with many nodes
      const largeGraph = createGraph({ namespace: 'large' })
      const now = Date.now()
      const relationships = []

      // User-1 follows 100 users
      for (let i = 2; i <= 101; i++) {
        relationships.push({
          id: `rel-a-${i}`,
          type: 'follows',
          from: 'user-1',
          to: `user-${i}`,
          createdAt: now,
        })
      }

      // User-2 follows 100 users, 50 overlap with user-1
      for (let i = 52; i <= 151; i++) {
        relationships.push({
          id: `rel-b-${i}`,
          type: 'follows',
          from: 'user-2',
          to: `user-${i}`,
          createdAt: now,
        })
      }

      largeGraph.addRelationships(relationships)

      const user1 = largeGraph.node('user-1')
      const user2 = largeGraph.node('user-2')

      const mutual = await user1.$.follows.intersect(user2.$.follows).ids()

      // Overlap: user-52 to user-101 = 50 users
      expect(mutual).toHaveLength(50)
    })
  })

  describe('Relationship Type Filtering', () => {
    it('should only consider specified relationship type in set operations', async () => {
      // Add some different relationship types
      const now = Date.now()
      graph.addRelationships([
        { id: 'block-1', type: 'blocks', from: 'alice', to: 'eve', createdAt: now },
        { id: 'block-2', type: 'blocks', from: 'bob', to: 'eve', createdAt: now },
      ])

      const alice = graph.node('alice')
      const bob = graph.node('bob')

      // Intersect should only consider 'follows' not 'blocks'
      const mutualFollows = await alice.$.follows.intersect(bob.$.follows).ids()

      expect(mutualFollows).toContain('carol')
      expect(mutualFollows).not.toContain('eve') // eve is blocked, not followed by both
    })
  })
})

// ============================================================================
// AGGREGATION WITH SET OPERATIONS
// ============================================================================

describe('Aggregations with Set Operations', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  describe('Count', () => {
    it('should count intersect results', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const count = await alice.$.follows.intersect(bob.$.follows).count()

      expect(count).toBe(1)
    })

    it('should count union results', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const count = await alice.$.follows.union(bob.$.follows).count()

      expect(count).toBe(5) // bob, carol, dave, eve, frank
    })

    it('should count except results', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const count = await alice.$.follows.except(bob.$.follows).count()

      expect(count).toBe(2) // bob, dave
    })
  })

  describe('Exists', () => {
    it('should check if intersect has results', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const exists = await alice.$.follows.intersect(bob.$.follows).exists()

      expect(exists).toBe(true)
    })

    it('should return false when intersect is empty', async () => {
      const alice = graph.node('alice')
      const frank = graph.node('frank')

      const exists = await alice.$.follows.intersect(frank.$.follows).exists()

      expect(exists).toBe(false)
    })
  })

  describe('First', () => {
    it('should get first result from intersect', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const first = await alice.$.follows.intersect(bob.$.follows).first()

      expect(first).not.toBeNull()
      expect(first!.id).toBe('carol')
    })

    it('should return null when intersect is empty', async () => {
      const alice = graph.node('alice')
      const frank = graph.node('frank')

      const first = await alice.$.follows.intersect(frank.$.follows).first()

      expect(first).toBeNull()
    })
  })
})

// ============================================================================
// ASYNC ITERATION WITH SET OPERATIONS
// ============================================================================

describe('Async Iteration with Set Operations', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  it('should iterate over intersect results', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')

    const results: string[] = []
    for await (const node of alice.$.follows.intersect(bob.$.follows)) {
      results.push(node.id)
    }

    expect(results).toContain('carol')
  })

  it('should iterate over union results', async () => {
    const alice = graph.node('alice')
    const frank = graph.node('frank')

    const results: string[] = []
    for await (const node of alice.$.follows.union(frank.$.follows)) {
      results.push(node.id)
    }

    expect(results.length).toBe(5)
  })

  it('should iterate over except results', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')

    const results: string[] = []
    for await (const node of alice.$.follows.except(bob.$.follows)) {
      results.push(node.id)
    }

    expect(results).toContain('bob')
    expect(results).toContain('dave')
    expect(results).not.toContain('carol')
  })
})

// ============================================================================
// TYPE SAFETY TESTS (compile-time verification)
// ============================================================================

describe('Type Safety', () => {
  let graph: Graph

  beforeEach(() => {
    graph = createSocialGraph()
  })

  it('should return Traversal type from intersect', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')

    const traversal = alice.$.follows.intersect(bob.$.follows)

    // Type should be Traversal - verify by calling traversal methods
    expect(typeof traversal.ids).toBe('function')
    expect(typeof traversal.nodes).toBe('function')
    expect(typeof traversal.count).toBe('function')
    expect(typeof traversal.first).toBe('function')
    expect(typeof traversal.exists).toBe('function')
  })

  it('should allow chaining set operations with traversals', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')

    // This should compile and work
    const result = await alice.$.follows
      .intersect(bob.$.follows)
      .limit(5)
      .ids()

    expect(Array.isArray(result)).toBe(true)
  })

  it('should allow chaining multiple set operations', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')
    const carol = graph.node('carol')

    // This should compile and work
    const result = await alice.$.follows
      .intersect(bob.$.follows)
      .union(carol.$.follows)
      .except(graph.from('eve'))
      .ids()

    expect(Array.isArray(result)).toBe(true)
  })
})
