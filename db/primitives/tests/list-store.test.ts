/**
 * ListStore tests
 *
 * RED phase: These tests define the expected behavior of ListStore.
 * All tests should FAIL until implementation is complete.
 *
 * ListStore provides Redis-compatible list operations:
 * - lpush/rpush for head/tail insertion
 * - lpop/rpop for head/tail removal
 * - lrange for range queries
 * - llen for length
 * - lindex/lset for index-based access
 * - lrem/ltrim/linsert/lpos for manipulation
 * - Blocking operations via async iterators
 * - Max length enforcement
 * - TTL support at list level
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ListStore,
  createListStore,
  type ListStoreOptions,
  type ListPosition,
} from '../list-store'
import { TestMetricsCollector } from '../observability'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

function createTestStore<T = string>(options?: ListStoreOptions): ListStore<T> {
  return createListStore<T>(options)
}

/**
 * Helper to collect items from an async iterator with timeout
 */
async function collectWithTimeout<T>(
  iterator: AsyncIterator<T>,
  maxItems: number,
  timeoutMs: number
): Promise<T[]> {
  const results: T[] = []
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs)
  )

  while (results.length < maxItems) {
    const result = await Promise.race([iterator.next(), timeout])
    if (result === 'timeout') break
    if (typeof result === 'object' && 'done' in result) {
      if (result.done) break
      results.push(result.value)
    }
  }
  return results
}

// ============================================================================
// BASIC LPUSH/RPUSH OPERATIONS
// ============================================================================

describe('ListStore', () => {
  describe('lpush (left/head push)', () => {
    it('should push a single element to the head', async () => {
      const store = createTestStore()

      const length = await store.lpush('mylist', 'first')

      expect(length).toBe(1)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['first'])
    })

    it('should push multiple elements to the head', async () => {
      const store = createTestStore()

      const length = await store.lpush('mylist', 'a', 'b', 'c')

      // Elements are pushed left-to-right, so 'c' ends up at head
      // Just like Redis: LPUSH mylist a b c -> [c, b, a]
      expect(length).toBe(3)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['c', 'b', 'a'])
    })

    it('should prepend to existing list', async () => {
      const store = createTestStore()

      await store.lpush('mylist', 'existing')
      const length = await store.lpush('mylist', 'new')

      expect(length).toBe(2)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['new', 'existing'])
    })

    it('should handle complex objects', async () => {
      const store = createTestStore<{ id: number; name: string }>()

      await store.lpush('objects', { id: 1, name: 'first' })
      await store.lpush('objects', { id: 2, name: 'second' })

      const range = await store.lrange('objects', 0, -1)
      expect(range).toHaveLength(2)
      expect(range[0]).toEqual({ id: 2, name: 'second' })
      expect(range[1]).toEqual({ id: 1, name: 'first' })
    })
  })

  describe('rpush (right/tail push)', () => {
    it('should push a single element to the tail', async () => {
      const store = createTestStore()

      const length = await store.rpush('mylist', 'first')

      expect(length).toBe(1)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['first'])
    })

    it('should push multiple elements to the tail', async () => {
      const store = createTestStore()

      const length = await store.rpush('mylist', 'a', 'b', 'c')

      // Elements are pushed left-to-right at tail
      expect(length).toBe(3)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'b', 'c'])
    })

    it('should append to existing list', async () => {
      const store = createTestStore()

      await store.rpush('mylist', 'existing')
      const length = await store.rpush('mylist', 'new')

      expect(length).toBe(2)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['existing', 'new'])
    })
  })

  // ============================================================================
  // LPOP/RPOP OPERATIONS
  // ============================================================================

  describe('lpop (left/head pop)', () => {
    it('should pop element from head', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const value = await store.lpop('mylist')

      expect(value).toBe('a')
      const remaining = await store.lrange('mylist', 0, -1)
      expect(remaining).toEqual(['b', 'c'])
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const value = await store.lpop('nonexistent')

      expect(value).toBeNull()
    })

    it('should return null for empty list', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'only')
      await store.lpop('mylist')

      const value = await store.lpop('mylist')

      expect(value).toBeNull()
    })

    it('should pop multiple elements with count', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      const values = await store.lpop('mylist', 3)

      expect(values).toEqual(['a', 'b', 'c'])
      const remaining = await store.lrange('mylist', 0, -1)
      expect(remaining).toEqual(['d', 'e'])
    })

    it('should return only available elements when count exceeds length', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b')

      const values = await store.lpop('mylist', 5)

      expect(values).toEqual(['a', 'b'])
    })
  })

  describe('rpop (right/tail pop)', () => {
    it('should pop element from tail', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const value = await store.rpop('mylist')

      expect(value).toBe('c')
      const remaining = await store.lrange('mylist', 0, -1)
      expect(remaining).toEqual(['a', 'b'])
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const value = await store.rpop('nonexistent')

      expect(value).toBeNull()
    })

    it('should pop multiple elements with count', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      const values = await store.rpop('mylist', 3)

      // Pops from tail, so returns in reverse order of removal
      expect(values).toEqual(['e', 'd', 'c'])
      const remaining = await store.lrange('mylist', 0, -1)
      expect(remaining).toEqual(['a', 'b'])
    })
  })

  // ============================================================================
  // LRANGE QUERIES
  // ============================================================================

  describe('lrange (range queries)', () => {
    beforeEach(async () => {
      // Common setup
    })

    it('should return entire list with 0 to -1', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      const range = await store.lrange('mylist', 0, -1)

      expect(range).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('should return subset with positive indices', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      const range = await store.lrange('mylist', 1, 3)

      expect(range).toEqual(['b', 'c', 'd'])
    })

    it('should handle negative indices', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      // -2 is 'd', -1 is 'e'
      const range = await store.lrange('mylist', -2, -1)

      expect(range).toEqual(['d', 'e'])
    })

    it('should handle mixed positive and negative indices', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      const range = await store.lrange('mylist', 1, -2)

      expect(range).toEqual(['b', 'c', 'd'])
    })

    it('should return empty array for out-of-range indices', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const range = await store.lrange('mylist', 10, 20)

      expect(range).toEqual([])
    })

    it('should return empty array when start > stop', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const range = await store.lrange('mylist', 3, 1)

      expect(range).toEqual([])
    })

    it('should return empty array for non-existent key', async () => {
      const store = createTestStore()

      const range = await store.lrange('nonexistent', 0, -1)

      expect(range).toEqual([])
    })

    it('should handle single element ranges', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const range = await store.lrange('mylist', 1, 1)

      expect(range).toEqual(['b'])
    })
  })

  // ============================================================================
  // LLEN (LENGTH)
  // ============================================================================

  describe('llen (length)', () => {
    it('should return list length', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const length = await store.llen('mylist')

      expect(length).toBe(3)
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const length = await store.llen('nonexistent')

      expect(length).toBe(0)
    })

    it('should update correctly after operations', async () => {
      const store = createTestStore()

      await store.rpush('mylist', 'a')
      expect(await store.llen('mylist')).toBe(1)

      await store.rpush('mylist', 'b', 'c')
      expect(await store.llen('mylist')).toBe(3)

      await store.lpop('mylist')
      expect(await store.llen('mylist')).toBe(2)
    })
  })

  // ============================================================================
  // LINDEX (INDEX ACCESS)
  // ============================================================================

  describe('lindex (index access)', () => {
    it('should return element at positive index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      expect(await store.lindex('mylist', 0)).toBe('a')
      expect(await store.lindex('mylist', 2)).toBe('c')
      expect(await store.lindex('mylist', 4)).toBe('e')
    })

    it('should return element at negative index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      expect(await store.lindex('mylist', -1)).toBe('e')
      expect(await store.lindex('mylist', -3)).toBe('c')
      expect(await store.lindex('mylist', -5)).toBe('a')
    })

    it('should return null for out-of-range index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      expect(await store.lindex('mylist', 10)).toBeNull()
      expect(await store.lindex('mylist', -10)).toBeNull()
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      expect(await store.lindex('nonexistent', 0)).toBeNull()
    })
  })

  // ============================================================================
  // LSET (INDEX SET)
  // ============================================================================

  describe('lset (index set)', () => {
    it('should set element at positive index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      await store.lset('mylist', 1, 'B')

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'B', 'c'])
    })

    it('should set element at negative index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      await store.lset('mylist', -1, 'C')

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'b', 'C'])
    })

    it('should throw for out-of-range index', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      await expect(store.lset('mylist', 10, 'x')).rejects.toThrow()
    })

    it('should throw for non-existent key', async () => {
      const store = createTestStore()

      await expect(store.lset('nonexistent', 0, 'x')).rejects.toThrow()
    })
  })

  // ============================================================================
  // LREM (REMOVE BY VALUE)
  // ============================================================================

  describe('lrem (remove by value)', () => {
    it('should remove all occurrences when count is 0', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'a', 'c', 'a')

      const removed = await store.lrem('mylist', 0, 'a')

      expect(removed).toBe(3)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['b', 'c'])
    })

    it('should remove count occurrences from head when count > 0', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'a', 'c', 'a')

      const removed = await store.lrem('mylist', 2, 'a')

      expect(removed).toBe(2)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['b', 'c', 'a'])
    })

    it('should remove count occurrences from tail when count < 0', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'a', 'c', 'a')

      const removed = await store.lrem('mylist', -2, 'a')

      expect(removed).toBe(2)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'b', 'c'])
    })

    it('should return 0 when element not found', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const removed = await store.lrem('mylist', 0, 'x')

      expect(removed).toBe(0)
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const removed = await store.lrem('nonexistent', 0, 'x')

      expect(removed).toBe(0)
    })

    it('should work with object equality', async () => {
      const store = createTestStore<{ id: number }>()
      const obj = { id: 1 }
      await store.rpush('objects', obj, { id: 2 }, obj)

      // By reference or deep equality depending on implementation
      const removed = await store.lrem('objects', 0, obj)

      expect(removed).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // LTRIM (TRIM LIST)
  // ============================================================================

  describe('ltrim (trim list)', () => {
    it('should keep only elements in range', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      await store.ltrim('mylist', 1, 3)

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['b', 'c', 'd'])
    })

    it('should handle negative indices', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'd', 'e')

      await store.ltrim('mylist', -3, -1)

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['c', 'd', 'e'])
    })

    it('should delete list when trimming to empty range', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      await store.ltrim('mylist', 10, 20)

      expect(await store.llen('mylist')).toBe(0)
    })

    it('should handle non-existent key gracefully', async () => {
      const store = createTestStore()

      await expect(store.ltrim('nonexistent', 0, 1)).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // LINSERT (INSERT RELATIVE TO ELEMENT)
  // ============================================================================

  describe('linsert (insert relative to element)', () => {
    it('should insert before pivot element', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const length = await store.linsert('mylist', 'BEFORE', 'b', 'X')

      expect(length).toBe(4)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'X', 'b', 'c'])
    })

    it('should insert after pivot element', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const length = await store.linsert('mylist', 'AFTER', 'b', 'X')

      expect(length).toBe(4)
      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['a', 'b', 'X', 'c'])
    })

    it('should return -1 when pivot not found', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const length = await store.linsert('mylist', 'BEFORE', 'x', 'X')

      expect(length).toBe(-1)
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const length = await store.linsert('nonexistent', 'BEFORE', 'x', 'X')

      expect(length).toBe(0)
    })
  })

  // ============================================================================
  // LPOS (FIND POSITION)
  // ============================================================================

  describe('lpos (find position)', () => {
    it('should find first occurrence', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'b', 'd')

      const pos = await store.lpos('mylist', 'b')

      expect(pos).toBe(1)
    })

    it('should return null when element not found', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const pos = await store.lpos('mylist', 'x')

      expect(pos).toBeNull()
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const pos = await store.lpos('nonexistent', 'x')

      expect(pos).toBeNull()
    })

    it('should find nth occurrence with rank option', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'b', 'd', 'b')

      // Rank 2 means find 2nd occurrence
      const pos = await store.lpos('mylist', 'b', { rank: 2 })

      expect(pos).toBe(3)
    })

    it('should search from end with negative rank', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'b', 'd', 'b')

      // Rank -1 means find last occurrence
      const pos = await store.lpos('mylist', 'b', { rank: -1 })

      expect(pos).toBe(5)
    })

    it('should return multiple positions with count option', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'b', 'd', 'b')

      const positions = await store.lpos('mylist', 'b', { count: 2 })

      expect(positions).toEqual([1, 3])
    })

    it('should return all positions with count 0', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c', 'b', 'd', 'b')

      const positions = await store.lpos('mylist', 'b', { count: 0 })

      expect(positions).toEqual([1, 3, 5])
    })
  })

  // ============================================================================
  // BLOCKING OPERATIONS (ASYNC ITERATORS)
  // ============================================================================

  describe('blocking operations (async iterators)', () => {
    describe('blpop (blocking left pop)', () => {
      it('should pop immediately if list has elements', async () => {
        const store = createTestStore()
        await store.rpush('mylist', 'a', 'b', 'c')

        const iterator = store.blpop('mylist')
        const result = await iterator.next()

        expect(result.done).toBe(false)
        expect(result.value).toEqual({ key: 'mylist', value: 'a' })
      })

      it('should wait for push when list is empty', async () => {
        const store = createTestStore()
        const iterator = store.blpop('mylist')

        // Start waiting
        const resultPromise = iterator.next()

        // Push after a short delay
        setTimeout(async () => {
          await store.rpush('mylist', 'pushed')
        }, 10)

        const result = await resultPromise
        expect(result.done).toBe(false)
        expect(result.value).toEqual({ key: 'mylist', value: 'pushed' })
      })

      it('should monitor multiple keys', async () => {
        const store = createTestStore()
        const iterator = store.blpop('list1', 'list2', 'list3')

        // Push to list2
        setTimeout(async () => {
          await store.rpush('list2', 'value')
        }, 10)

        const result = await iterator.next()
        expect(result.value?.key).toBe('list2')
        expect(result.value?.value).toBe('value')
      })

      it('should respect priority order of keys', async () => {
        const store = createTestStore()

        // Populate multiple lists
        await store.rpush('list1', 'v1')
        await store.rpush('list2', 'v2')
        await store.rpush('list3', 'v3')

        // First key with elements should be returned first
        const iterator = store.blpop('list1', 'list2', 'list3')
        const result = await iterator.next()

        expect(result.value?.key).toBe('list1')
        expect(result.value?.value).toBe('v1')
      })

      it('should support timeout option', async () => {
        const store = createTestStore()
        const iterator = store.blpop('emptylist', { timeout: 50 })

        const result = await iterator.next()

        expect(result.done).toBe(true)
        expect(result.value).toBeUndefined()
      })

      it('should allow iteration until explicitly stopped', async () => {
        const store = createTestStore()
        await store.rpush('mylist', 'a', 'b', 'c')

        const iterator = store.blpop('mylist')
        const results: string[] = []

        for (let i = 0; i < 3; i++) {
          const result = await iterator.next()
          if (result.done) break
          results.push(result.value!.value)
        }

        expect(results).toEqual(['a', 'b', 'c'])
      })

      it('should clean up when iterator is returned', async () => {
        const store = createTestStore()
        const iterator = store.blpop('mylist')

        // Return/cleanup the iterator
        await iterator.return?.()

        // Subsequent next() should return done
        const result = await iterator.next()
        expect(result.done).toBe(true)
      })
    })

    describe('brpop (blocking right pop)', () => {
      it('should pop from tail immediately if list has elements', async () => {
        const store = createTestStore()
        await store.rpush('mylist', 'a', 'b', 'c')

        const iterator = store.brpop('mylist')
        const result = await iterator.next()

        expect(result.done).toBe(false)
        expect(result.value).toEqual({ key: 'mylist', value: 'c' })
      })

      it('should wait for push when list is empty', async () => {
        const store = createTestStore()
        const iterator = store.brpop('mylist')

        setTimeout(async () => {
          await store.lpush('mylist', 'pushed')
        }, 10)

        const result = await iterator.next()
        expect(result.value?.value).toBe('pushed')
      })
    })

    describe('lmpop (pop from multiple lists)', () => {
      it('should pop from first non-empty list', async () => {
        const store = createTestStore()
        await store.rpush('list2', 'a', 'b')
        await store.rpush('list3', 'x', 'y')

        const result = await store.lmpop(['list1', 'list2', 'list3'], 'LEFT')

        expect(result).not.toBeNull()
        expect(result?.key).toBe('list2')
        expect(result?.values).toEqual(['a'])
      })

      it('should pop count elements', async () => {
        const store = createTestStore()
        await store.rpush('mylist', 'a', 'b', 'c', 'd')

        const result = await store.lmpop(['mylist'], 'LEFT', 2)

        expect(result?.values).toEqual(['a', 'b'])
      })

      it('should return null when all lists empty', async () => {
        const store = createTestStore()

        const result = await store.lmpop(['empty1', 'empty2'], 'LEFT')

        expect(result).toBeNull()
      })
    })

    describe('lmove (move between lists)', () => {
      it('should move from left to right', async () => {
        const store = createTestStore()
        await store.rpush('src', 'a', 'b', 'c')

        const value = await store.lmove('src', 'dst', 'LEFT', 'RIGHT')

        expect(value).toBe('a')
        expect(await store.lrange('src', 0, -1)).toEqual(['b', 'c'])
        expect(await store.lrange('dst', 0, -1)).toEqual(['a'])
      })

      it('should move from right to left', async () => {
        const store = createTestStore()
        await store.rpush('src', 'a', 'b', 'c')

        const value = await store.lmove('src', 'dst', 'RIGHT', 'LEFT')

        expect(value).toBe('c')
        expect(await store.lrange('src', 0, -1)).toEqual(['a', 'b'])
        expect(await store.lrange('dst', 0, -1)).toEqual(['c'])
      })

      it('should return null for non-existent source', async () => {
        const store = createTestStore()

        const value = await store.lmove('nonexistent', 'dst', 'LEFT', 'RIGHT')

        expect(value).toBeNull()
      })
    })

    describe('blmove (blocking move)', () => {
      it('should move immediately if source has elements', async () => {
        const store = createTestStore()
        await store.rpush('src', 'a', 'b')

        const value = await store.blmove('src', 'dst', 'LEFT', 'RIGHT', 100)

        expect(value).toBe('a')
      })

      it('should wait for source to have elements', async () => {
        const store = createTestStore()

        const movePromise = store.blmove('src', 'dst', 'LEFT', 'RIGHT', 1000)

        setTimeout(async () => {
          await store.rpush('src', 'pushed')
        }, 10)

        const value = await movePromise
        expect(value).toBe('pushed')
      })

      it('should return null on timeout', async () => {
        const store = createTestStore()

        const value = await store.blmove('empty', 'dst', 'LEFT', 'RIGHT', 50)

        expect(value).toBeNull()
      })
    })
  })

  // ============================================================================
  // MAX LENGTH ENFORCEMENT
  // ============================================================================

  describe('max length enforcement', () => {
    it('should enforce max length on lpush', async () => {
      const store = createTestStore({ maxLength: 3 })
      await store.rpush('mylist', 'a', 'b', 'c')

      // Should trim from opposite end
      await store.lpush('mylist', 'new')

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toHaveLength(3)
      expect(range[0]).toBe('new')
    })

    it('should enforce max length on rpush', async () => {
      const store = createTestStore({ maxLength: 3 })
      await store.lpush('mylist', 'c', 'b', 'a')

      await store.rpush('mylist', 'new')

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toHaveLength(3)
      expect(range[range.length - 1]).toBe('new')
    })

    it('should support approximate trimming', async () => {
      // Like Redis MAXLEN ~1000 for performance
      const store = createTestStore({ maxLength: 1000, approximate: true })

      for (let i = 0; i < 1100; i++) {
        await store.rpush('mylist', `item-${i}`)
      }

      const length = await store.llen('mylist')
      // Should be approximately 1000, not exactly
      expect(length).toBeLessThanOrEqual(1100)
      expect(length).toBeGreaterThanOrEqual(900)
    })

    it('should support per-list max length', async () => {
      const store = createTestStore()

      // Set max length on specific list
      await store.rpush('bounded', 'a', 'b', 'c', { maxLength: 2 })

      const range = await store.lrange('bounded', 0, -1)
      expect(range).toHaveLength(2)
    })
  })

  // ============================================================================
  // TTL SUPPORT
  // ============================================================================

  describe('TTL support', () => {
    it('should set TTL on list', async () => {
      vi.useFakeTimers()

      try {
        const store = createTestStore({ enableTTL: true })
        await store.rpush('mylist', 'a', 'b', 'c')

        await store.expire('mylist', 1000)

        // Available before expiration
        expect(await store.llen('mylist')).toBe(3)

        // Advance past TTL
        vi.advanceTimersByTime(1100)

        // Should be expired
        expect(await store.llen('mylist')).toBe(0)
        expect(await store.lrange('mylist', 0, -1)).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })

    it('should get remaining TTL', async () => {
      vi.useFakeTimers()

      try {
        const store = createTestStore({ enableTTL: true })
        await store.rpush('mylist', 'value')
        await store.expire('mylist', 1000)

        vi.advanceTimersByTime(300)

        const ttl = await store.ttl('mylist')
        expect(ttl).toBeCloseTo(700, -2) // Approximately 700ms
      } finally {
        vi.useRealTimers()
      }
    })

    it('should return -1 for key without TTL', async () => {
      const store = createTestStore({ enableTTL: true })
      await store.rpush('mylist', 'value')

      const ttl = await store.ttl('mylist')

      expect(ttl).toBe(-1)
    })

    it('should return -2 for non-existent key', async () => {
      const store = createTestStore({ enableTTL: true })

      const ttl = await store.ttl('nonexistent')

      expect(ttl).toBe(-2)
    })

    it('should remove TTL with persist', async () => {
      vi.useFakeTimers()

      try {
        const store = createTestStore({ enableTTL: true })
        await store.rpush('mylist', 'value')
        await store.expire('mylist', 1000)

        await store.persist('mylist')

        vi.advanceTimersByTime(2000)

        expect(await store.llen('mylist')).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should support expireAt for absolute timestamps', async () => {
      vi.useFakeTimers()

      try {
        const store = createTestStore({ enableTTL: true })
        await store.rpush('mylist', 'value')

        const expireTime = Date.now() + 500
        await store.expireAt('mylist', expireTime)

        vi.advanceTimersByTime(600)

        expect(await store.llen('mylist')).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record operation latencies', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.rpush('mylist', 'a', 'b', 'c')
      await store.lpop('mylist')
      await store.lrange('mylist', 0, -1)

      const latencies = metrics.getByType('latency')
      expect(latencies.length).toBeGreaterThanOrEqual(3)

      const rpushLatencies = metrics.getByName('list_store.rpush.latency')
      expect(rpushLatencies.length).toBe(1)
    })

    it('should track list length gauge', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.rpush('mylist', 'a', 'b', 'c')
      await store.lpop('mylist')

      const lengthGauges = metrics.getByName('list_store.length')
      expect(lengthGauges.length).toBeGreaterThan(0)
    })

    it('should count operations', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.lpush('list', 'a')
      await store.rpush('list', 'b')
      await store.lpush('list', 'c')

      const pushCount = metrics.getCounterTotal('list_store.pushes')
      expect(pushCount).toBe(3)
    })

    it('should track blocking operation wait times', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.rpush('mylist', 'immediate')

      const iterator = store.blpop('mylist')
      await iterator.next()
      await iterator.return?.()

      const blockingLatencies = metrics.getByName('list_store.blpop.latency')
      expect(blockingLatencies.length).toBe(1)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty string values', async () => {
      const store = createTestStore()

      await store.rpush('mylist', '', 'a', '')

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual(['', 'a', ''])
    })

    it('should handle null values if type allows', async () => {
      const store = createTestStore<string | null>()

      await store.rpush('mylist', null, 'a', null)

      const range = await store.lrange('mylist', 0, -1)
      expect(range).toEqual([null, 'a', null])
    })

    it('should handle very large lists', async () => {
      const store = createTestStore()

      const values = Array.from({ length: 10000 }, (_, i) => `item-${i}`)
      await store.rpush('biglist', ...values)

      expect(await store.llen('biglist')).toBe(10000)
      expect(await store.lindex('biglist', 5000)).toBe('item-5000')
    })

    it('should handle concurrent operations', async () => {
      const store = createTestStore()

      await Promise.all([
        store.rpush('list', 'a'),
        store.rpush('list', 'b'),
        store.rpush('list', 'c'),
        store.lpush('list', 'x'),
        store.lpush('list', 'y'),
      ])

      const length = await store.llen('list')
      expect(length).toBe(5)
    })

    it('should handle keys with special characters', async () => {
      const store = createTestStore()

      await store.rpush('key:with:colons', 'a')
      await store.rpush('key/with/slashes', 'b')
      await store.rpush('key@with@ats', 'c')

      expect(await store.llen('key:with:colons')).toBe(1)
      expect(await store.llen('key/with/slashes')).toBe(1)
      expect(await store.llen('key@with@ats')).toBe(1)
    })

    it('should delete empty list after all pops', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'only')

      await store.lpop('mylist')

      // List should be deleted
      expect(await store.exists('mylist')).toBe(false)
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('type safety', () => {
    it('should enforce generic type constraints', async () => {
      interface User {
        id: number
        name: string
      }

      const store = createListStore<User>()

      await store.rpush('users', { id: 1, name: 'Alice' })
      await store.lpush('users', { id: 2, name: 'Bob' })

      const users = await store.lrange('users', 0, -1)

      // Type inference should work
      expect(users[0].id).toBe(2)
      expect(users[0].name).toBe('Bob')
    })
  })

  // ============================================================================
  // ADDITIONAL REDIS COMPAT
  // ============================================================================

  describe('Redis compatibility', () => {
    it('should support lpushx (push only if exists)', async () => {
      const store = createTestStore()

      // Should not create new list
      const length1 = await store.lpushx('mylist', 'a')
      expect(length1).toBe(0)
      expect(await store.exists('mylist')).toBe(false)

      // Create list first
      await store.rpush('mylist', 'x')

      // Now lpushx should work
      const length2 = await store.lpushx('mylist', 'a')
      expect(length2).toBe(2)
    })

    it('should support rpushx (push only if exists)', async () => {
      const store = createTestStore()

      const length1 = await store.rpushx('mylist', 'a')
      expect(length1).toBe(0)

      await store.lpush('mylist', 'x')

      const length2 = await store.rpushx('mylist', 'a')
      expect(length2).toBe(2)
    })

    it('should support exists check', async () => {
      const store = createTestStore()

      expect(await store.exists('mylist')).toBe(false)

      await store.rpush('mylist', 'a')

      expect(await store.exists('mylist')).toBe(true)
    })

    it('should support del (delete list)', async () => {
      const store = createTestStore()
      await store.rpush('mylist', 'a', 'b', 'c')

      const deleted = await store.del('mylist')

      expect(deleted).toBe(true)
      expect(await store.exists('mylist')).toBe(false)
    })

    it('should support rename', async () => {
      const store = createTestStore()
      await store.rpush('oldname', 'a', 'b', 'c')

      await store.rename('oldname', 'newname')

      expect(await store.exists('oldname')).toBe(false)
      expect(await store.lrange('newname', 0, -1)).toEqual(['a', 'b', 'c'])
    })

    it('should support copy', async () => {
      const store = createTestStore()
      await store.rpush('src', 'a', 'b', 'c')

      await store.copy('src', 'dst')

      expect(await store.lrange('src', 0, -1)).toEqual(['a', 'b', 'c'])
      expect(await store.lrange('dst', 0, -1)).toEqual(['a', 'b', 'c'])
    })
  })
})
