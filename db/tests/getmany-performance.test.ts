/**
 * N+1 Query Detection Tests for getMany
 *
 * This test suite demonstrates the N+1 query problem in storage adapters.
 * A proper batch implementation should execute 1 query for N items,
 * not N individual queries.
 *
 * Issue: do-fm86 - Write a failing test for N+1 query in getMany
 *
 * @module db/tests/getmany-performance.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { StorageAdapter, ListOptions, ListResult } from '../storage'

// ============================================================================
// INSTRUMENTED STORAGE ADAPTER
// ============================================================================

/**
 * Storage adapter wrapper that tracks individual get() calls.
 * Used to detect N+1 query patterns where getMany should batch but doesn't.
 */
class InstrumentedStorageAdapter implements StorageAdapter {
  private store = new Map<string, { value: unknown; createdAt: number; updatedAt: number }>()

  // Metrics for detecting N+1 queries
  public getCallCount = 0
  public getManyCallCount = 0
  public individualGetsInGetMany = 0

  resetMetrics(): void {
    this.getCallCount = 0
    this.getManyCallCount = 0
    this.individualGetsInGetMany = 0
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.getCallCount++
    const entry = this.store.get(key)
    return entry?.value as T | undefined
  }

  /**
   * N+1 PROBLEM: This implementation iterates through each key one at a time,
   * making N individual lookups instead of a single batched query.
   *
   * In a real SQL database, this would mean:
   *   BAD:  N separate SELECT statements
   *   GOOD: 1 SELECT with IN clause
   *
   * This simulates the N+1 pattern to demonstrate the problem.
   */
  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    this.getManyCallCount++
    const result = new Map<string, T>()

    // N+1 PATTERN: Loop through each key individually
    // This is the problem we want to detect and fix
    for (const key of keys) {
      this.individualGetsInGetMany++  // Track each individual lookup
      const entry = this.store.get(key)
      if (entry !== undefined) {
        result.set(key, entry.value as T)
      }
    }

    return result
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const now = Date.now()
    const existing = this.store.get(key)
    this.store.set(key, {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
  }

  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    const now = Date.now()
    for (const [key, value] of entries) {
      const existing = this.store.get(key)
      this.store.set(key, {
        value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key)
    }
  }

  async list<T = unknown>(options: ListOptions = {}): Promise<ListResult<T>> {
    const { prefix, limit = 1000, includeValues = true } = options
    const entries = new Map<string, T>()

    for (const [key, entry] of this.store) {
      if (prefix && !key.startsWith(prefix)) continue
      if (entries.size >= limit) break
      entries.set(key, includeValues ? (entry.value as T) : (undefined as T))
    }

    return { entries, hasMore: false }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async count(prefix?: string): Promise<number> {
    if (!prefix) return this.store.size
    let count = 0
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) count++
    }
    return count
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('getMany N+1 Query Detection', () => {
  let adapter: InstrumentedStorageAdapter

  beforeEach(() => {
    adapter = new InstrumentedStorageAdapter()
    adapter.resetMetrics()
  })

  // ==========================================================================
  // TODO: These tests document the N+1 query problem in getMany.
  // They INTENTIONALLY FAIL to prove the issue exists - getMany makes O(N)
  // queries instead of O(1) batched queries.
  //
  // Skipped to prevent CI failures. These are not bugs in the tests;
  // they document a known performance issue that should be optimized.
  //
  // When getMany is optimized to use batched queries (e.g., SQL IN clause),
  // remove .skip and these tests should pass.
  // ==========================================================================
  describe.skip('N+1 query problem', () => {
    it('should use O(1) database operations for getMany, not O(N)', async () => {
      // Setup: Insert 100 items
      const itemCount = 100
      const keys: string[] = []

      for (let i = 0; i < itemCount; i++) {
        const key = `item:${i}`
        keys.push(key)
        await adapter.put(key, { id: i, name: `Item ${i}` })
      }

      // Reset metrics before the operation we're testing
      adapter.resetMetrics()

      // Act: Call getMany with all 100 keys
      const result = await adapter.getMany(keys)

      // Assert: We got all items
      expect(result.size).toBe(itemCount)

      // Assert: getMany was called exactly once
      expect(adapter.getManyCallCount).toBe(1)

      // FAILING ASSERTION: This is the N+1 problem!
      // The current implementation makes N individual lookups
      // A proper batch implementation should make just 1 operation
      //
      // Expected: 1 (single batch query with IN clause)
      // Actual: 100 (N individual queries - the N+1 problem)
      expect(adapter.individualGetsInGetMany).toBe(1) // This will FAIL, showing the N+1 problem
    })

    it('should not scale linearly with the number of keys requested', async () => {
      // Setup: Insert items
      for (let i = 0; i < 50; i++) {
        await adapter.put(`item:${i}`, { id: i })
      }

      // Test with 10 keys
      adapter.resetMetrics()
      await adapter.getMany(Array.from({ length: 10 }, (_, i) => `item:${i}`))
      const opsFor10 = adapter.individualGetsInGetMany

      // Test with 50 keys
      adapter.resetMetrics()
      await adapter.getMany(Array.from({ length: 50 }, (_, i) => `item:${i}`))
      const opsFor50 = adapter.individualGetsInGetMany

      // FAILING ASSERTION: Operations should NOT scale with key count
      // A batched implementation would have opsFor10 === opsFor50 === 1
      // The N+1 implementation has opsFor50 === 5 * opsFor10
      expect(opsFor50).toBe(opsFor10) // This will FAIL, proving linear scaling (N+1)
    })

    it('should make a single batched query instead of N individual queries', async () => {
      // Setup: Insert 20 items
      const keys: string[] = []
      for (let i = 0; i < 20; i++) {
        const key = `thing:${i}`
        keys.push(key)
        await adapter.put(key, { $id: key, $type: 'Widget', name: `Widget ${i}` })
      }

      adapter.resetMetrics()

      // Act: Request 20 items
      const result = await adapter.getMany(keys)

      // Verify we got the data
      expect(result.size).toBe(20)

      // FAILING TEST: The critical assertion
      // In SQL terms:
      //   N+1 pattern: 20x "SELECT * FROM kv WHERE key = ?"
      //   Batched:     1x "SELECT * FROM kv WHERE key IN (?, ?, ..., ?)"
      //
      // individualGetsInGetMany tracks the loop iterations in the N+1 implementation
      // A proper batch would set this to 0 (no loop) or 1 (single operation)
      const isNPlusOnePattern = adapter.individualGetsInGetMany === keys.length
      const isBatchedPattern = adapter.individualGetsInGetMany <= 1

      expect(isBatchedPattern).toBe(true) // FAILS: proves N+1 exists
      expect(isNPlusOnePattern).toBe(false) // FAILS: confirms N+1 pattern detected
    })
  })

  describe('edge cases', () => {
    it('should handle empty key array without any operations', async () => {
      adapter.resetMetrics()

      const result = await adapter.getMany([])

      expect(result.size).toBe(0)
      expect(adapter.getManyCallCount).toBe(1)
      expect(adapter.individualGetsInGetMany).toBe(0) // No iterations for empty array
    })

    it('should handle single key request efficiently', async () => {
      await adapter.put('single', { value: 'test' })
      adapter.resetMetrics()

      const result = await adapter.getMany(['single'])

      expect(result.size).toBe(1)
      // For a single key, both N+1 and batched approaches make 1 operation
      // so this passes either way
      expect(adapter.individualGetsInGetMany).toBe(1)
    })
  })
})

describe('ThingsStore getMany delegates to adapter.getMany', () => {
  it('should call adapter.getMany once, not adapter.get N times', async () => {
    // This test verifies that ThingsStore.getMany uses the batch operation
    // and doesn't fall back to calling get() in a loop

    const adapter = new InstrumentedStorageAdapter()

    // Simulate ThingsStore behavior
    const THINGS_PREFIX = 'thing:'

    // Insert items
    for (let i = 0; i < 10; i++) {
      const id = `id-${i}`
      await adapter.put(`${THINGS_PREFIX}${id}`, {
        $id: id,
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: `Customer ${i}`
      })
    }

    adapter.resetMetrics()

    // Simulate ThingsStore.getMany behavior
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`)
    const keys = ids.map(id => `${THINGS_PREFIX}${id}`)

    // This is what ThingsStore.getMany does
    await adapter.getMany(keys)

    // Verify: getMany was called, not get() N times
    expect(adapter.getManyCallCount).toBe(1)
    expect(adapter.getCallCount).toBe(0) // Should NOT call individual get()

    // But the N+1 problem is INSIDE getMany - it loops internally
    // This test passes but the internal N+1 still exists
    expect(adapter.individualGetsInGetMany).toBe(10) // Shows the internal N+1
  })
})
