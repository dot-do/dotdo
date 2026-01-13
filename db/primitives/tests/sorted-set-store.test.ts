/**
 * SortedSetStore tests
 *
 * TDD RED phase: These tests define the expected behavior of SortedSetStore.
 * SortedSetStore provides Redis ZADD/ZRANGE-like operations for score-ordered sets.
 *
 * Features:
 * - zadd/zrem for member management with scores
 * - zrange/zrevrange for index-based queries
 * - zrangebyscore for score-based queries
 * - zrank/zrevrank for position lookup
 * - zincrby for score increment
 * - O(log n) operations via skip list or balanced tree
 *
 * Maps to Redis: ZADD, ZREM, ZRANGE, ZREVRANGE, ZSCORE, ZRANK, ZREVRANK, ZCARD, ZCOUNT, ZINCRBY, ZRANGEBYSCORE, ZPOPMIN, ZPOPMAX
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSortedSetStore,
  type SortedSetStore,
  type ScoredMember,
  type ZAddOptions,
  type ZRangeOptions,
} from '../sorted-set-store'
import { TestMetricsCollector } from '../observability'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestStore(): SortedSetStore<string> {
  return createSortedSetStore<string>()
}

function createTestStoreWithMetrics(): { store: SortedSetStore<string>; metrics: TestMetricsCollector } {
  const metrics = new TestMetricsCollector()
  const store = createSortedSetStore<string>({ metrics })
  return { store, metrics }
}

// ============================================================================
// BASIC ZADD/ZREM OPERATIONS
// ============================================================================

describe('SortedSetStore', () => {
  describe('basic zadd/zrem operations', () => {
    it('should add a member with score', async () => {
      const store = createTestStore()

      const added = await store.zadd('leaderboard', 100, 'alice')

      expect(added).toBe(1)
      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBe(100)
    })

    it('should add multiple members in a single call', async () => {
      const store = createTestStore()

      const added = await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      expect(added).toBe(3)
      expect(await store.zcard('leaderboard')).toBe(3)
    })

    it('should update score when member already exists', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const added = await store.zadd('leaderboard', 200, 'alice')

      expect(added).toBe(0) // No new member added
      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBe(200)
    })

    it('should respect NX option (only add if not exists)', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const added = await store.zadd('leaderboard', 200, 'alice', { nx: true })

      expect(added).toBe(0)
      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBe(100) // Score unchanged
    })

    it('should respect XX option (only update if exists)', async () => {
      const store = createTestStore()

      const added = await store.zadd('leaderboard', 100, 'alice', { xx: true })

      expect(added).toBe(0)
      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBeNull() // Member not added
    })

    it('should respect GT option (only update if new score > current)', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')

      const added1 = await store.zadd('leaderboard', 50, 'alice', { gt: true })
      expect(await store.zscore('leaderboard', 'alice')).toBe(100) // Unchanged

      const added2 = await store.zadd('leaderboard', 200, 'alice', { gt: true })
      expect(await store.zscore('leaderboard', 'alice')).toBe(200) // Updated
    })

    it('should respect LT option (only update if new score < current)', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')

      await store.zadd('leaderboard', 200, 'alice', { lt: true })
      expect(await store.zscore('leaderboard', 'alice')).toBe(100) // Unchanged

      await store.zadd('leaderboard', 50, 'alice', { lt: true })
      expect(await store.zscore('leaderboard', 'alice')).toBe(50) // Updated
    })

    it('should return changed count with CH option', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const changed = await store.zadd('leaderboard', 200, 'alice', { ch: true })

      expect(changed).toBe(1) // Score was changed
    })

    it('should remove a member', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const removed = await store.zrem('leaderboard', 'alice')

      expect(removed).toBe(1)
      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBeNull()
    })

    it('should remove multiple members', async () => {
      const store = createTestStore()

      await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      const removed = await store.zremMulti('leaderboard', ['alice', 'charlie'])

      expect(removed).toBe(2)
      expect(await store.zcard('leaderboard')).toBe(1)
    })

    it('should return 0 when removing non-existent member', async () => {
      const store = createTestStore()

      const removed = await store.zrem('leaderboard', 'nonexistent')

      expect(removed).toBe(0)
    })

    it('should handle empty sorted set', async () => {
      const store = createTestStore()

      const score = await store.zscore('leaderboard', 'alice')
      expect(score).toBeNull()

      const card = await store.zcard('leaderboard')
      expect(card).toBe(0)
    })
  })

  // ============================================================================
  // ZSCORE AND ZCARD
  // ============================================================================

  describe('zscore and zcard', () => {
    it('should return score for existing member', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 42.5, 'alice')
      const score = await store.zscore('leaderboard', 'alice')

      expect(score).toBe(42.5)
    })

    it('should return null for non-existent member', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const score = await store.zscore('leaderboard', 'bob')

      expect(score).toBeNull()
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const score = await store.zscore('nonexistent', 'alice')

      expect(score).toBeNull()
    })

    it('should return cardinality of sorted set', async () => {
      const store = createTestStore()

      await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      const card = await store.zcard('leaderboard')

      expect(card).toBe(3)
    })

    it('should return 0 for empty/non-existent key', async () => {
      const store = createTestStore()

      const card = await store.zcard('nonexistent')

      expect(card).toBe(0)
    })
  })

  // ============================================================================
  // ZRANGE AND ZREVRANGE (Index-based queries)
  // ============================================================================

  describe('zrange/zrevrange (index-based queries)', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
        { member: 'david', score: 50 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should return members in ascending score order', async () => {
      const members = await store.zrange('leaderboard', 0, -1)

      expect(members).toEqual(['david', 'alice', 'charlie', 'bob', 'eve'])
    })

    it('should return members with scores when withScores is true', async () => {
      const members = await store.zrangeWithScores('leaderboard', 0, -1)

      expect(members).toEqual([
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should handle positive start/stop indices', async () => {
      const members = await store.zrange('leaderboard', 1, 3)

      expect(members).toEqual(['alice', 'charlie', 'bob'])
    })

    it('should handle negative indices', async () => {
      const members = await store.zrange('leaderboard', -3, -1)

      expect(members).toEqual(['charlie', 'bob', 'eve'])
    })

    it('should handle out-of-range indices gracefully', async () => {
      const members = await store.zrange('leaderboard', 0, 100)

      expect(members).toEqual(['david', 'alice', 'charlie', 'bob', 'eve'])
    })

    it('should return empty array for invalid range', async () => {
      const members = await store.zrange('leaderboard', 3, 1)

      expect(members).toEqual([])
    })

    it('should return members in descending score order with zrevrange', async () => {
      const members = await store.zrevrange('leaderboard', 0, -1)

      expect(members).toEqual(['eve', 'bob', 'charlie', 'alice', 'david'])
    })

    it('should handle zrevrange with scores', async () => {
      const members = await store.zrevrangeWithScores('leaderboard', 0, 2)

      expect(members).toEqual([
        { member: 'eve', score: 300 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])
    })

    it('should return empty array for non-existent key', async () => {
      const members = await store.zrange('nonexistent', 0, -1)

      expect(members).toEqual([])
    })

    it('should handle single element range', async () => {
      const members = await store.zrange('leaderboard', 2, 2)

      expect(members).toEqual(['charlie'])
    })
  })

  // ============================================================================
  // ZRANGEBYSCORE (Score-based queries)
  // ============================================================================

  describe('zrangebyscore (score-based queries)', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should return members within score range (inclusive)', async () => {
      const members = await store.zrangebyscore('leaderboard', 100, 200)

      expect(members).toEqual(['alice', 'charlie', 'bob'])
    })

    it('should return members with scores', async () => {
      const members = await store.zrangebyscoreWithScores('leaderboard', 100, 200)

      expect(members).toEqual([
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
      ])
    })

    it('should support -Infinity as min', async () => {
      const members = await store.zrangebyscore('leaderboard', -Infinity, 100)

      expect(members).toEqual(['david', 'alice'])
    })

    it('should support +Infinity as max', async () => {
      const members = await store.zrangebyscore('leaderboard', 200, Infinity)

      expect(members).toEqual(['bob', 'eve'])
    })

    it('should support exclusive bounds', async () => {
      const members = await store.zrangebyscore('leaderboard', 100, 200, {
        minExclusive: true,
        maxExclusive: true,
      })

      expect(members).toEqual(['charlie'])
    })

    it('should support LIMIT option', async () => {
      const members = await store.zrangebyscore('leaderboard', -Infinity, Infinity, {
        offset: 1,
        count: 2,
      })

      expect(members).toEqual(['alice', 'charlie'])
    })

    it('should return empty array when no members in range', async () => {
      const members = await store.zrangebyscore('leaderboard', 400, 500)

      expect(members).toEqual([])
    })

    it('should return in descending order with zrevrangebyscore', async () => {
      const members = await store.zrevrangebyscore('leaderboard', 200, 100)

      expect(members).toEqual(['bob', 'charlie', 'alice'])
    })
  })

  // ============================================================================
  // ZRANK AND ZREVRANK (Position lookup)
  // ============================================================================

  describe('zrank/zrevrank (position lookup)', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should return 0-based rank in ascending order', async () => {
      expect(await store.zrank('leaderboard', 'david')).toBe(0) // lowest score
      expect(await store.zrank('leaderboard', 'alice')).toBe(1)
      expect(await store.zrank('leaderboard', 'charlie')).toBe(2)
      expect(await store.zrank('leaderboard', 'bob')).toBe(3)
      expect(await store.zrank('leaderboard', 'eve')).toBe(4) // highest score
    })

    it('should return null for non-existent member', async () => {
      const rank = await store.zrank('leaderboard', 'nonexistent')

      expect(rank).toBeNull()
    })

    it('should return null for non-existent key', async () => {
      const rank = await store.zrank('nonexistent', 'alice')

      expect(rank).toBeNull()
    })

    it('should return 0-based rank in descending order with zrevrank', async () => {
      expect(await store.zrevrank('leaderboard', 'eve')).toBe(0) // highest score
      expect(await store.zrevrank('leaderboard', 'bob')).toBe(1)
      expect(await store.zrevrank('leaderboard', 'charlie')).toBe(2)
      expect(await store.zrevrank('leaderboard', 'alice')).toBe(3)
      expect(await store.zrevrank('leaderboard', 'david')).toBe(4) // lowest score
    })
  })

  // ============================================================================
  // ZINCRBY (Score increment)
  // ============================================================================

  describe('zincrby (score increment)', () => {
    it('should increment score and return new value', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const newScore = await store.zincrby('leaderboard', 50, 'alice')

      expect(newScore).toBe(150)
      expect(await store.zscore('leaderboard', 'alice')).toBe(150)
    })

    it('should create member if not exists', async () => {
      const store = createTestStore()

      const newScore = await store.zincrby('leaderboard', 100, 'alice')

      expect(newScore).toBe(100)
      expect(await store.zscore('leaderboard', 'alice')).toBe(100)
    })

    it('should handle negative increment (decrement)', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const newScore = await store.zincrby('leaderboard', -30, 'alice')

      expect(newScore).toBe(70)
    })

    it('should handle floating point increments', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 10, 'alice')
      const newScore = await store.zincrby('leaderboard', 0.5, 'alice')

      expect(newScore).toBe(10.5)
    })

    it('should maintain correct ordering after increment', async () => {
      const store = createTestStore()

      await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      await store.zincrby('leaderboard', 100, 'alice') // alice: 100 -> 200

      const members = await store.zrange('leaderboard', 0, -1)
      // charlie(150) < alice(200) = bob(200), but alice was incremented after bob
      // When scores are equal, members should be ordered lexicographically
      expect(members).toEqual(['charlie', 'alice', 'bob'])
    })
  })

  // ============================================================================
  // ZCOUNT (Count in score range)
  // ============================================================================

  describe('zcount (count in score range)', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should count members in score range', async () => {
      const count = await store.zcount('leaderboard', 100, 200)

      expect(count).toBe(3) // alice, charlie, bob
    })

    it('should count all members with -Infinity to +Infinity', async () => {
      const count = await store.zcount('leaderboard', -Infinity, Infinity)

      expect(count).toBe(5)
    })

    it('should return 0 for empty range', async () => {
      const count = await store.zcount('leaderboard', 400, 500)

      expect(count).toBe(0)
    })

    it('should return 0 for non-existent key', async () => {
      const count = await store.zcount('nonexistent', 0, 100)

      expect(count).toBe(0)
    })
  })

  // ============================================================================
  // ZPOPMIN AND ZPOPMAX
  // ============================================================================

  describe('zpopmin/zpopmax', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should pop and return member with lowest score', async () => {
      const result = await store.zpopmin('leaderboard')

      expect(result).toEqual({ member: 'david', score: 50 })
      expect(await store.zcard('leaderboard')).toBe(4)
      expect(await store.zscore('leaderboard', 'david')).toBeNull()
    })

    it('should pop multiple members with lowest scores', async () => {
      const results = await store.zpopminMulti('leaderboard', 2)

      expect(results).toEqual([
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
      ])
      expect(await store.zcard('leaderboard')).toBe(3)
    })

    it('should pop and return member with highest score', async () => {
      const result = await store.zpopmax('leaderboard')

      expect(result).toEqual({ member: 'eve', score: 300 })
      expect(await store.zcard('leaderboard')).toBe(4)
    })

    it('should pop multiple members with highest scores', async () => {
      const results = await store.zpopmaxMulti('leaderboard', 2)

      expect(results).toEqual([
        { member: 'eve', score: 300 },
        { member: 'bob', score: 200 },
      ])
      expect(await store.zcard('leaderboard')).toBe(3)
    })

    it('should return null for empty set (zpopmin)', async () => {
      const emptyStore = createTestStore()
      const result = await emptyStore.zpopmin('leaderboard')

      expect(result).toBeNull()
    })

    it('should return null for empty set (zpopmax)', async () => {
      const emptyStore = createTestStore()
      const result = await emptyStore.zpopmax('leaderboard')

      expect(result).toBeNull()
    })

    it('should return fewer items if count exceeds set size', async () => {
      const results = await store.zpopminMulti('leaderboard', 10)

      expect(results.length).toBe(5)
    })
  })

  // ============================================================================
  // ZREMRANGEBYRANK
  // ============================================================================

  describe('zremrangebyrank', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should remove members by rank range', async () => {
      const removed = await store.zremrangebyrank('leaderboard', 0, 1)

      expect(removed).toBe(2)
      expect(await store.zcard('leaderboard')).toBe(3)
      const members = await store.zrange('leaderboard', 0, -1)
      expect(members).toEqual(['charlie', 'bob', 'eve'])
    })

    it('should support negative indices', async () => {
      const removed = await store.zremrangebyrank('leaderboard', -2, -1)

      expect(removed).toBe(2)
      const members = await store.zrange('leaderboard', 0, -1)
      expect(members).toEqual(['david', 'alice', 'charlie'])
    })
  })

  // ============================================================================
  // ZREMRANGEBYSCORE
  // ============================================================================

  describe('zremrangebyscore', () => {
    let store: SortedSetStore<string>

    beforeEach(async () => {
      store = createTestStore()
      await store.zaddMulti('leaderboard', [
        { member: 'david', score: 50 },
        { member: 'alice', score: 100 },
        { member: 'charlie', score: 150 },
        { member: 'bob', score: 200 },
        { member: 'eve', score: 300 },
      ])
    })

    it('should remove members by score range', async () => {
      const removed = await store.zremrangebyscore('leaderboard', 100, 200)

      expect(removed).toBe(3) // alice, charlie, bob
      expect(await store.zcard('leaderboard')).toBe(2)
      const members = await store.zrange('leaderboard', 0, -1)
      expect(members).toEqual(['david', 'eve'])
    })

    it('should support -Infinity and +Infinity', async () => {
      const removed = await store.zremrangebyscore('leaderboard', -Infinity, 100)

      expect(removed).toBe(2) // david, alice
      const members = await store.zrange('leaderboard', 0, -1)
      expect(members).toEqual(['charlie', 'bob', 'eve'])
    })
  })

  // ============================================================================
  // LEXICOGRAPHIC ORDERING
  // ============================================================================

  describe('lexicographic ordering', () => {
    it('should order members lexicographically when scores are equal', async () => {
      const store = createTestStore()

      await store.zaddMulti('names', [
        { member: 'charlie', score: 0 },
        { member: 'alice', score: 0 },
        { member: 'bob', score: 0 },
      ])

      const members = await store.zrange('names', 0, -1)

      expect(members).toEqual(['alice', 'bob', 'charlie'])
    })

    it('should maintain lex order after score updates that result in ties', async () => {
      const store = createTestStore()

      await store.zaddMulti('names', [
        { member: 'zoe', score: 100 },
        { member: 'alice', score: 50 },
      ])

      // Update alice to match zoe's score
      await store.zadd('names', 100, 'alice')

      const members = await store.zrange('names', 0, -1)

      // alice comes before zoe lexicographically
      expect(members).toEqual(['alice', 'zoe'])
    })
  })

  // ============================================================================
  // TTL SUPPORT
  // ============================================================================

  describe('TTL support', () => {
    it('should set TTL on sorted set', async () => {
      const store = createSortedSetStore<string>({ enableTTL: true })

      await store.zadd('leaderboard', 100, 'alice')
      const result = await store.expire('leaderboard', 1000)

      expect(result).toBe(true)
      const ttl = await store.ttl('leaderboard')
      expect(ttl).toBeLessThanOrEqual(1000)
      expect(ttl).toBeGreaterThan(0)
    })

    it('should return -1 for key without TTL', async () => {
      const store = createSortedSetStore<string>({ enableTTL: true })

      await store.zadd('leaderboard', 100, 'alice')
      const ttl = await store.ttl('leaderboard')

      expect(ttl).toBe(-1)
    })

    it('should return -2 for non-existent key', async () => {
      const store = createSortedSetStore<string>({ enableTTL: true })

      const ttl = await store.ttl('nonexistent')

      expect(ttl).toBe(-2)
    })

    it('should persist key (remove TTL)', async () => {
      const store = createSortedSetStore<string>({ enableTTL: true })

      await store.zadd('leaderboard', 100, 'alice')
      await store.expire('leaderboard', 1000)
      const result = await store.persist('leaderboard')

      expect(result).toBe(true)
      expect(await store.ttl('leaderboard')).toBe(-1)
    })
  })

  // ============================================================================
  // MULTIPLE SORTED SETS
  // ============================================================================

  describe('multiple sorted sets', () => {
    it('should maintain independent sorted sets', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard1', 100, 'alice')
      await store.zadd('leaderboard2', 200, 'alice')

      expect(await store.zscore('leaderboard1', 'alice')).toBe(100)
      expect(await store.zscore('leaderboard2', 'alice')).toBe(200)
    })

    it('should delete a sorted set', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard', 100, 'alice')
      const deleted = await store.del('leaderboard')

      expect(deleted).toBe(true)
      expect(await store.zcard('leaderboard')).toBe(0)
    })

    it('should list all keys', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard1', 100, 'alice')
      await store.zadd('leaderboard2', 200, 'bob')
      await store.zadd('scores', 300, 'charlie')

      const keys = await store.keys()

      expect(keys.sort()).toEqual(['leaderboard1', 'leaderboard2', 'scores'])
    })

    it('should list keys matching pattern', async () => {
      const store = createTestStore()

      await store.zadd('leaderboard:game1', 100, 'alice')
      await store.zadd('leaderboard:game2', 200, 'bob')
      await store.zadd('scores', 300, 'charlie')

      const keys = await store.keys('leaderboard:*')

      expect(keys.sort()).toEqual(['leaderboard:game1', 'leaderboard:game2'])
    })
  })

  // ============================================================================
  // PERFORMANCE - O(log n) OPERATIONS
  // ============================================================================

  describe('performance characteristics', () => {
    it('should handle large sorted set efficiently', async () => {
      const store = createTestStore()

      // Add 10,000 members
      const members: Array<{ member: string; score: number }> = []
      for (let i = 0; i < 10000; i++) {
        members.push({ member: `member${i}`, score: Math.random() * 10000 })
      }

      const startAdd = performance.now()
      await store.zaddMulti('large', members)
      const addTime = performance.now() - startAdd

      // Bulk add should be efficient
      expect(addTime).toBeLessThan(1000) // Should complete in < 1s

      // Rank lookup should be O(log n)
      const startRank = performance.now()
      for (let i = 0; i < 100; i++) {
        await store.zrank('large', `member${Math.floor(Math.random() * 10000)}`)
      }
      const rankTime = performance.now() - startRank

      // 100 rank lookups should be fast
      expect(rankTime).toBeLessThan(100) // < 1ms per lookup

      // Score lookup should be O(1) or O(log n)
      const startScore = performance.now()
      for (let i = 0; i < 100; i++) {
        await store.zscore('large', `member${Math.floor(Math.random() * 10000)}`)
      }
      const scoreTime = performance.now() - startScore

      expect(scoreTime).toBeLessThan(50) // Very fast

      expect(await store.zcard('large')).toBe(10000)
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record metrics for zadd operation', async () => {
      const { store, metrics } = createTestStoreWithMetrics()

      await store.zadd('leaderboard', 100, 'alice')

      const latencies = metrics.getByName('sorted_set_store.zadd.latency')
      expect(latencies.length).toBeGreaterThan(0)
    })

    it('should record metrics for zrange operation', async () => {
      const { store, metrics } = createTestStoreWithMetrics()

      await store.zadd('leaderboard', 100, 'alice')
      await store.zrange('leaderboard', 0, -1)

      const latencies = metrics.getByName('sorted_set_store.zrange.latency')
      expect(latencies.length).toBeGreaterThan(0)
    })

    it('should record member count gauge', async () => {
      const { store, metrics } = createTestStoreWithMetrics()

      await store.zaddMulti('leaderboard', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
      ])

      const gauges = metrics.getByName('sorted_set_store.member_count')
      expect(gauges.length).toBeGreaterThan(0)
      expect(metrics.getLatestGauge('sorted_set_store.member_count')).toBe(2)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle very large scores', async () => {
      const store = createTestStore()

      await store.zadd('large', Number.MAX_SAFE_INTEGER, 'max')
      await store.zadd('large', -Number.MAX_SAFE_INTEGER, 'min')

      expect(await store.zscore('large', 'max')).toBe(Number.MAX_SAFE_INTEGER)
      expect(await store.zscore('large', 'min')).toBe(-Number.MAX_SAFE_INTEGER)

      const members = await store.zrange('large', 0, -1)
      expect(members).toEqual(['min', 'max'])
    })

    it('should handle floating point scores with precision', async () => {
      const store = createTestStore()

      await store.zadd('float', 0.1 + 0.2, 'a') // 0.30000000000000004
      await store.zadd('float', 0.3, 'b')

      // These should be stored as different values
      const scoreA = await store.zscore('float', 'a')
      const scoreB = await store.zscore('float', 'b')

      expect(scoreA).not.toBe(scoreB)
    })

    it('should handle special string members', async () => {
      const store = createTestStore()

      await store.zadd('special', 1, '')
      await store.zadd('special', 2, ' ')
      await store.zadd('special', 3, 'a b c')
      await store.zadd('special', 4, '\n\t')

      expect(await store.zcard('special')).toBe(4)
      expect(await store.zscore('special', '')).toBe(1)
    })

    it('should handle zero score', async () => {
      const store = createTestStore()

      await store.zadd('zero', 0, 'alice')
      await store.zadd('zero', -0, 'bob') // -0 should equal 0

      expect(await store.zscore('zero', 'alice')).toBe(0)
      // bob should update alice since -0 === 0 is same value
      expect(await store.zcard('zero')).toBe(2) // Actually separate entries since different members
    })

    it('should handle NaN score gracefully', async () => {
      const store = createTestStore()

      // NaN handling - should reject or treat specially
      await expect(store.zadd('nan', NaN, 'alice')).rejects.toThrow()
    })

    it('should handle Infinity scores', async () => {
      const store = createTestStore()

      await store.zadd('inf', Infinity, 'max')
      await store.zadd('inf', -Infinity, 'min')

      const members = await store.zrange('inf', 0, -1)
      expect(members).toEqual(['min', 'max'])
    })

    it('should handle concurrent updates to same member', async () => {
      const store = createTestStore()

      // Rapid updates should all be consistent
      await store.zadd('concurrent', 100, 'alice')
      await store.zadd('concurrent', 200, 'alice')
      await store.zadd('concurrent', 150, 'alice')
      await store.zadd('concurrent', 300, 'alice')

      expect(await store.zscore('concurrent', 'alice')).toBe(300)
      expect(await store.zcard('concurrent')).toBe(1)
    })

    it('should handle member removal then re-add', async () => {
      const store = createTestStore()

      await store.zadd('reuse', 100, 'alice')
      await store.zrem('reuse', 'alice')
      await store.zadd('reuse', 200, 'alice')

      expect(await store.zscore('reuse', 'alice')).toBe(200)
      expect(await store.zcard('reuse')).toBe(1)
    })

    it('should handle score updates that change ordering multiple times', async () => {
      const store = createTestStore()

      await store.zaddMulti('shuffle', [
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
        { member: 'c', score: 3 },
      ])

      // Move 'a' to the end
      await store.zadd('shuffle', 10, 'a')
      expect(await store.zrange('shuffle', 0, -1)).toEqual(['b', 'c', 'a'])

      // Move 'a' back to the beginning
      await store.zadd('shuffle', 0, 'a')
      expect(await store.zrange('shuffle', 0, -1)).toEqual(['a', 'b', 'c'])

      // Move 'c' to the middle
      await store.zadd('shuffle', 1.5, 'c')
      expect(await store.zrange('shuffle', 0, -1)).toEqual(['a', 'c', 'b'])
    })
  })

  // ============================================================================
  // COMPOSITE OPERATIONS (simulating ZUNIONSTORE / ZINTERSTORE semantics)
  // ============================================================================

  describe('composite operations (union/intersection patterns)', () => {
    it('should simulate ZUNIONSTORE with SUM aggregate', async () => {
      const store = createTestStore()

      // Set A: leaderboard:day1
      await store.zaddMulti('leaderboard:day1', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      // Set B: leaderboard:day2
      await store.zaddMulti('leaderboard:day2', [
        { member: 'bob', score: 50 },
        { member: 'charlie', score: 100 },
        { member: 'david', score: 300 },
      ])

      // Manual union with SUM aggregate into leaderboard:total
      const setA = await store.zrangeWithScores('leaderboard:day1', 0, -1)
      const setB = await store.zrangeWithScores('leaderboard:day2', 0, -1)

      const unionMap = new Map<string, number>()
      for (const { member, score } of setA) {
        unionMap.set(member, (unionMap.get(member) ?? 0) + score)
      }
      for (const { member, score } of setB) {
        unionMap.set(member, (unionMap.get(member) ?? 0) + score)
      }

      for (const [member, score] of unionMap) {
        await store.zadd('leaderboard:total', score, member)
      }

      // Verify union results
      expect(await store.zcard('leaderboard:total')).toBe(4)
      expect(await store.zscore('leaderboard:total', 'alice')).toBe(100) // only in day1
      expect(await store.zscore('leaderboard:total', 'bob')).toBe(250) // 200 + 50
      expect(await store.zscore('leaderboard:total', 'charlie')).toBe(250) // 150 + 100
      expect(await store.zscore('leaderboard:total', 'david')).toBe(300) // only in day2
    })

    it('should simulate ZINTERSTORE with MIN aggregate', async () => {
      const store = createTestStore()

      // Set A
      await store.zaddMulti('set:a', [
        { member: 'alice', score: 100 },
        { member: 'bob', score: 200 },
        { member: 'charlie', score: 150 },
      ])

      // Set B
      await store.zaddMulti('set:b', [
        { member: 'bob', score: 50 },
        { member: 'charlie', score: 200 },
        { member: 'david', score: 300 },
      ])

      // Manual intersection with MIN aggregate
      const setA = await store.zrangeWithScores('set:a', 0, -1)
      const setB = await store.zrangeWithScores('set:b', 0, -1)

      const mapB = new Map(setB.map(({ member, score }) => [member, score]))

      for (const { member, score: scoreA } of setA) {
        const scoreB = mapB.get(member)
        if (scoreB !== undefined) {
          await store.zadd('set:intersection', Math.min(scoreA, scoreB), member)
        }
      }

      // Verify intersection results
      expect(await store.zcard('set:intersection')).toBe(2) // bob and charlie
      expect(await store.zscore('set:intersection', 'bob')).toBe(50) // min(200, 50)
      expect(await store.zscore('set:intersection', 'charlie')).toBe(150) // min(150, 200)
      expect(await store.zscore('set:intersection', 'alice')).toBeNull() // not in both
      expect(await store.zscore('set:intersection', 'david')).toBeNull() // not in both
    })

    it('should simulate weighted union', async () => {
      const store = createTestStore()

      // Weighted scores for different categories
      await store.zaddMulti('category:tech', [
        { member: 'article1', score: 100 },
        { member: 'article2', score: 80 },
      ])

      await store.zaddMulti('category:business', [
        { member: 'article1', score: 50 },
        { member: 'article3', score: 120 },
      ])

      // Weights: tech = 2x, business = 1x
      const tech = await store.zrangeWithScores('category:tech', 0, -1)
      const business = await store.zrangeWithScores('category:business', 0, -1)

      const weightedUnion = new Map<string, number>()
      for (const { member, score } of tech) {
        weightedUnion.set(member, (weightedUnion.get(member) ?? 0) + score * 2)
      }
      for (const { member, score } of business) {
        weightedUnion.set(member, (weightedUnion.get(member) ?? 0) + score * 1)
      }

      for (const [member, score] of weightedUnion) {
        await store.zadd('combined', score, member)
      }

      expect(await store.zscore('combined', 'article1')).toBe(250) // 100*2 + 50*1
      expect(await store.zscore('combined', 'article2')).toBe(160) // 80*2
      expect(await store.zscore('combined', 'article3')).toBe(120) // 120*1
    })
  })

  // ============================================================================
  // RANKING USE CASES
  // ============================================================================

  describe('ranking use cases', () => {
    it('should implement a leaderboard with ranking', async () => {
      const store = createTestStore()

      // Add players with scores
      await store.zaddMulti('leaderboard', [
        { member: 'player1', score: 1500 },
        { member: 'player2', score: 2300 },
        { member: 'player3', score: 1800 },
        { member: 'player4', score: 2100 },
        { member: 'player5', score: 1200 },
      ])

      // Get top 3 players (highest scores first)
      const top3 = await store.zrevrangeWithScores('leaderboard', 0, 2)
      expect(top3).toEqual([
        { member: 'player2', score: 2300 },
        { member: 'player4', score: 2100 },
        { member: 'player3', score: 1800 },
      ])

      // Get a specific player's rank
      const player3Rank = await store.zrevrank('leaderboard', 'player3')
      expect(player3Rank).toBe(2) // 0-indexed, so 3rd place

      // Get players around a specific rank (neighbors)
      const player3Index = 2 // player3 is at index 2 in descending order
      const neighbors = await store.zrevrangeWithScores(
        'leaderboard',
        Math.max(0, player3Index - 1),
        player3Index + 1
      )
      expect(neighbors.map((n) => n.member)).toEqual(['player4', 'player3', 'player1'])
    })

    it('should implement time-based sliding window with scores', async () => {
      const store = createTestStore()

      const now = Date.now()

      // Add events with timestamps as scores
      await store.zaddMulti('events:hourly', [
        { member: 'event1', score: now - 3600000 - 1 }, // > 1 hour ago
        { member: 'event2', score: now - 1800000 }, // 30 min ago
        { member: 'event3', score: now - 600000 }, // 10 min ago
        { member: 'event4', score: now - 60000 }, // 1 min ago
      ])

      // Get events in the last hour
      const lastHour = await store.zrangebyscore('events:hourly', now - 3600000, now)
      expect(lastHour).toEqual(['event2', 'event3', 'event4'])

      // Remove events older than 1 hour
      const removed = await store.zremrangebyscore('events:hourly', -Infinity, now - 3600000)
      expect(removed).toBe(1) // event1

      // Verify remaining events
      expect(await store.zcard('events:hourly')).toBe(3)
    })

    it('should implement rate limiting with sorted set', async () => {
      const store = createTestStore()

      const userId = 'user123'
      const windowKey = `ratelimit:${userId}`
      const windowMs = 60000 // 1 minute window
      const maxRequests = 10

      const now = Date.now()

      // Simulate requests
      for (let i = 0; i < 12; i++) {
        const requestTime = now - (11 - i) * 5000 // Spread over ~55 seconds
        await store.zadd(windowKey, requestTime, `request:${i}`)
      }

      // Clean up requests outside the window
      await store.zremrangebyscore(windowKey, -Infinity, now - windowMs)

      // Count requests in window
      const requestCount = await store.zcount(windowKey, now - windowMs, now)

      // Check if rate limited
      const isRateLimited = requestCount >= maxRequests
      expect(isRateLimited).toBe(true)
    })

    it('should implement priority queue with zpopmin', async () => {
      const store = createTestStore()

      // Add tasks with priority (lower = higher priority)
      await store.zaddMulti('task:queue', [
        { member: 'send-email', score: 3 },
        { member: 'process-payment', score: 1 },
        { member: 'generate-report', score: 5 },
        { member: 'notify-user', score: 2 },
      ])

      // Process tasks in priority order
      const task1 = await store.zpopmin('task:queue')
      expect(task1?.member).toBe('process-payment')

      const task2 = await store.zpopmin('task:queue')
      expect(task2?.member).toBe('notify-user')

      const task3 = await store.zpopmin('task:queue')
      expect(task3?.member).toBe('send-email')

      // Remaining tasks
      expect(await store.zcard('task:queue')).toBe(1)
    })
  })

  // ============================================================================
  // CONCURRENT ACCESS PATTERNS
  // ============================================================================

  describe('concurrent access patterns', () => {
    it('should handle concurrent zadd operations correctly', async () => {
      const store = createTestStore()

      // Simulate concurrent adds
      const operations = Array.from({ length: 100 }, (_, i) =>
        store.zadd('concurrent', i, `member${i}`)
      )

      await Promise.all(operations)

      expect(await store.zcard('concurrent')).toBe(100)

      // Verify ordering is maintained
      const first10 = await store.zrange('concurrent', 0, 9)
      expect(first10).toEqual([
        'member0',
        'member1',
        'member2',
        'member3',
        'member4',
        'member5',
        'member6',
        'member7',
        'member8',
        'member9',
      ])
    })

    it('should handle concurrent zincrby operations', async () => {
      const store = createTestStore()

      await store.zadd('counter', 0, 'item')

      // Simulate 100 concurrent increments
      const increments = Array.from({ length: 100 }, () => store.zincrby('counter', 1, 'item'))

      await Promise.all(increments)

      expect(await store.zscore('counter', 'item')).toBe(100)
    })
  })
})
