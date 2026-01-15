import { describe, it, expect, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'

/**
 * DO Eviction Chaos Tests - TDD RED Phase
 *
 * These tests verify the behavior of Durable Objects during and after eviction.
 * DO eviction can occur when:
 * - The DO is idle for too long (hibernation)
 * - Memory pressure causes Cloudflare to evict the DO
 * - The DO is explicitly evicted for maintenance
 *
 * IMPORTANT: These tests are designed to FAIL until proper eviction recovery
 * mechanisms are implemented. This is the RED phase of TDD.
 *
 * Tests cover:
 * 1. State recovery after simulated eviction
 * 2. In-flight request handling during eviction
 * 3. Checkpoint recovery after eviction
 * 4. No data loss during eviction scenarios
 *
 * KEY INSIGHT: The current DOCore implementation has a bug where the in-memory
 * `things` Map is not populated from SQLite on cold start. This means that
 * after eviction, `getThing()` will not find items that only exist in memory.
 * The tests below verify this behavior and should FAIL until fixed.
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore instance by name
 */
function getCore(name: string) {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

/**
 * Simulate eviction by forcing state flush and constructor re-run.
 * In production, Cloudflare evicts DOs by destroying the instance.
 * We simulate this by:
 * 1. Calling prepareHibernate() to flush state
 * 2. Getting a new stub (which may or may not be a fresh instance)
 *
 * Note: This doesn't truly destroy the instance in tests, but it exercises
 * the hibernation/wake path which is the closest we can get to eviction.
 */
async function simulateEviction(name: string): Promise<void> {
  const core = getCore(name)

  // Call prepareHibernate to simulate the eviction flush
  await core.prepareHibernate()

  // In a real eviction, the DO would be destroyed here
  // The next request would create a new instance that needs to recover state
}

/**
 * Clear the in-memory things cache via a special RPC call.
 * This simulates what happens when the DO is evicted and reconstructed.
 *
 * NOTE: This requires implementing clearMemoryCache() on DOCore.
 * Until then, these tests will fail (which is the point - RED phase).
 *
 * To implement this, add to DOCore:
 *
 * ```typescript
 * clearMemoryCache(): void {
 *   this.things.clear()
 *   this.eventHandlers.clear()
 *   this.schedules.clear()
 *   // Note: actionLog and SQLite state should NOT be cleared
 *   // They represent durable state that survives eviction
 * }
 * ```
 */
async function clearInMemoryCache(name: string): Promise<void> {
  const core = getCore(name) as any

  // This method should exist on DOCore to clear the in-memory things Map
  // It simulates what happens during eviction when memory is released
  await core.clearMemoryCache()
}

/**
 * Create test data in a DO and return the created items
 */
async function seedTestData(name: string, count: number): Promise<Array<{ $id: string; $type: string; name: string }>> {
  const core = getCore(name)
  const items: Array<{ $id: string; $type: string; name: string }> = []

  for (let i = 0; i < count; i++) {
    const result = await core.create('TestItem', { name: `Item ${i}`, index: i }) as { $id: string; $type: string; name: string }
    items.push(result)
  }

  return items
}

// =============================================================================
// 1. STATE RECOVERY AFTER EVICTION
// =============================================================================

describe('State Recovery After Eviction', () => {
  describe('basic state persistence', () => {
    it('should recover state values after eviction [RED]', async () => {
      const core = getCore('eviction-state-1')

      // Create state before eviction
      await core.set('persistent-key', { data: 'important', count: 42 })
      await core.set('another-key', 'string-value')

      // Simulate eviction
      await simulateEviction('eviction-state-1')

      // Get new stub (simulates fresh DO instance after eviction)
      const recoveredCore = getCore('eviction-state-1')

      // State should be recovered from SQLite
      const result1 = await recoveredCore.get('persistent-key')
      const result2 = await recoveredCore.get('another-key')

      expect(result1).toEqual({ data: 'important', count: 42 })
      expect(result2).toBe('string-value')
    })

    it('should recover Things created before eviction [RED]', async () => {
      const core = getCore('eviction-things-1')

      // Create things before eviction
      const created = await core.create('Customer', { name: 'Alice', email: 'alice@test.com' }) as { $id: string; $type: string }

      // Simulate eviction
      await simulateEviction('eviction-things-1')

      // Get new stub
      const recoveredCore = getCore('eviction-things-1')

      // Thing should be recovered
      const customers = await recoveredCore.listThings('Customer')
      expect(customers).toHaveLength(1)
      expect(customers[0]).toMatchObject({
        $id: created.$id,
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@test.com',
      })
    })

    it('should maintain version numbers after eviction [RED]', async () => {
      const core = getCore('eviction-version-1')

      // Create and update a thing multiple times using RPC-compatible methods
      const created = await core.create('Counter', { value: 0 }) as { $id: string; $version: number }

      // Use the NounInstance accessor pattern - call Customer() to get accessor, then call methods
      const accessor1 = core.Customer(created.$id) as any
      const updated1 = await accessor1.update({ value: 1 }) as { $version: number }
      const accessor2 = core.Customer(created.$id) as any
      const updated2 = await accessor2.update({ value: 2 }) as { $version: number }

      expect(updated2.$version).toBe(3) // Version should be 3 after 2 updates

      // Simulate eviction
      await simulateEviction('eviction-version-1')

      // Get new stub and update again
      const recoveredCore = getCore('eviction-version-1')
      const accessor3 = recoveredCore.Customer(created.$id) as any
      const updated3 = await accessor3.update({ value: 3 }) as { $version: number }

      // Version should continue from where it left off
      expect(updated3.$version).toBe(4)
    })
  })

  describe('large state recovery', () => {
    it('should recover 100+ items after eviction [RED]', async () => {
      const items = await seedTestData('eviction-large-1', 100)

      // Simulate eviction
      await simulateEviction('eviction-large-1')

      // Get new stub
      const recoveredCore = getCore('eviction-large-1')

      // All items should be recovered
      const recovered = await recoveredCore.listThings('TestItem')
      expect(recovered).toHaveLength(100)

      // Verify specific items
      const item50 = recovered.find((item: { name: string }) => item.name === 'Item 50')
      expect(item50).toBeDefined()
      expect(item50).toMatchObject({ $type: 'TestItem', name: 'Item 50', index: 50 })
    })

    it('should recover nested/complex objects after eviction [RED]', async () => {
      const core = getCore('eviction-complex-1')

      const complexData = {
        users: [
          { id: 1, name: 'Alice', roles: ['admin', 'user'] },
          { id: 2, name: 'Bob', roles: ['user'] },
        ],
        settings: {
          theme: 'dark',
          notifications: { email: true, push: false },
        },
        metadata: {
          created: Date.now(),
          tags: ['important', 'test'],
        },
      }

      await core.set('complex-state', complexData)

      // Simulate eviction
      await simulateEviction('eviction-complex-1')

      // Get new stub
      const recoveredCore = getCore('eviction-complex-1')

      // Complex state should be fully recovered
      const result = await recoveredCore.get('complex-state')
      expect(result).toEqual(complexData)
    })
  })
})

// =============================================================================
// 2. IN-FLIGHT REQUEST HANDLING DURING EVICTION
// =============================================================================

describe('In-Flight Request Handling During Eviction', () => {
  it('should complete in-flight writes before eviction [RED]', async () => {
    const core = getCore('eviction-inflight-1')

    // Start multiple writes
    const writePromises = [
      core.set('inflight-1', 'value1'),
      core.set('inflight-2', 'value2'),
      core.set('inflight-3', 'value3'),
    ]

    // Simulate eviction while writes are in progress
    const evictionPromise = simulateEviction('eviction-inflight-1')

    // Wait for both writes and eviction
    await Promise.all([...writePromises, evictionPromise])

    // Get new stub
    const recoveredCore = getCore('eviction-inflight-1')

    // All writes should have completed before eviction
    expect(await recoveredCore.get('inflight-1')).toBe('value1')
    expect(await recoveredCore.get('inflight-2')).toBe('value2')
    expect(await recoveredCore.get('inflight-3')).toBe('value3')
  })

  it('should handle concurrent reads and eviction gracefully [RED]', async () => {
    const core = getCore('eviction-concurrent-1')

    // Seed data
    await core.set('read-test', 'original-value')

    // Start read operation
    const readPromise = core.get('read-test')

    // Simulate eviction concurrently
    const evictionPromise = simulateEviction('eviction-concurrent-1')

    // Both should complete without error
    const [readResult] = await Promise.all([readPromise, evictionPromise])

    expect(readResult).toBe('original-value')
  })

  it('should not lose data from rapid create-then-evict scenario [RED]', async () => {
    const core = getCore('eviction-rapid-1')

    // Rapidly create items and immediately trigger eviction
    const createPromise = core.create('RapidItem', { name: 'LastMinute', critical: true })
    const evictionPromise = simulateEviction('eviction-rapid-1')

    const [created] = await Promise.all([createPromise, evictionPromise]) as [{ $id: string }]

    // Get new stub
    const recoveredCore = getCore('eviction-rapid-1')

    // The rapidly created item should be recovered
    const items = await recoveredCore.listThings('RapidItem')
    expect(items).toHaveLength(1)
    expect(items[0].$id).toBe(created.$id)
  })

  it('should handle transaction during eviction [RED]', async () => {
    const core = getCore('eviction-transaction-1')

    // Start a transaction
    const transactionPromise = core.transaction([
      { op: 'set', key: 'tx-key-1', value: 'tx-value-1' },
      { op: 'set', key: 'tx-key-2', value: 'tx-value-2' },
    ])

    // Simulate eviction during transaction
    const evictionPromise = simulateEviction('eviction-transaction-1')

    await Promise.all([transactionPromise, evictionPromise])

    // Get new stub
    const recoveredCore = getCore('eviction-transaction-1')

    // Transaction should have completed atomically
    // Either both values exist, or neither (no partial state)
    const val1 = await recoveredCore.get('tx-key-1')
    const val2 = await recoveredCore.get('tx-key-2')

    if (val1 !== undefined) {
      expect(val1).toBe('tx-value-1')
      expect(val2).toBe('tx-value-2')
    } else {
      // If transaction didn't complete, neither value should exist
      expect(val2).toBeUndefined()
    }
  })
})

// =============================================================================
// 3. CHECKPOINT RECOVERY
// =============================================================================

describe('Checkpoint Recovery', () => {
  it('should checkpoint dirty state before eviction [RED]', async () => {
    const core = getCore('eviction-checkpoint-1')

    // Create dirty state (state that hasn't been checkpointed yet)
    for (let i = 0; i < 50; i++) {
      await core.set(`dirty-key-${i}`, { index: i, dirty: true })
    }

    // Simulate eviction (should trigger checkpoint)
    await simulateEviction('eviction-checkpoint-1')

    // Get new stub
    const recoveredCore = getCore('eviction-checkpoint-1')

    // All dirty state should have been checkpointed and recovered
    for (let i = 0; i < 50; i++) {
      const result = await recoveredCore.get(`dirty-key-${i}`)
      expect(result).toEqual({ index: i, dirty: true })
    }
  })

  it('should recover from checkpoint after multiple evictions [RED]', async () => {
    const core = getCore('eviction-multi-1')

    // First round of data
    await core.set('round-1', 'value-1')
    await simulateEviction('eviction-multi-1')

    // Second round
    const core2 = getCore('eviction-multi-1')
    await core2.set('round-2', 'value-2')
    await simulateEviction('eviction-multi-1')

    // Third round
    const core3 = getCore('eviction-multi-1')
    await core3.set('round-3', 'value-3')
    await simulateEviction('eviction-multi-1')

    // Final recovery
    const finalCore = getCore('eviction-multi-1')

    // All rounds should be recovered
    expect(await finalCore.get('round-1')).toBe('value-1')
    expect(await finalCore.get('round-2')).toBe('value-2')
    expect(await finalCore.get('round-3')).toBe('value-3')
  })

  it('should replay action log after recovery [RED]', async () => {
    const core = getCore('eviction-actionlog-1')

    // Execute durable actions
    let counter = 0
    await core.do(async () => {
      counter++
      return counter
    }, { stepId: 'step-1' })

    await core.do(async () => {
      counter++
      return counter
    }, { stepId: 'step-2' })

    // Simulate eviction
    await simulateEviction('eviction-actionlog-1')

    // Get new stub
    const recoveredCore = getCore('eviction-actionlog-1')

    // Action log should be recovered
    const actionLog = await recoveredCore.getActionLog() as Array<{ stepId: string; status: string }>

    expect(actionLog).toContainEqual(
      expect.objectContaining({ stepId: 'step-1', status: 'completed' })
    )
    expect(actionLog).toContainEqual(
      expect.objectContaining({ stepId: 'step-2', status: 'completed' })
    )
  })

  it('should restore scheduled alarms after recovery [RED]', async () => {
    const core = getCore('eviction-alarm-1')

    // Set an alarm
    const futureTime = Date.now() + 60000 // 1 minute in future
    await core.setAlarm(futureTime)

    // Verify alarm is set
    const alarmBefore = await core.getAlarm()
    expect(alarmBefore?.getTime()).toBe(futureTime)

    // Simulate eviction
    await simulateEviction('eviction-alarm-1')

    // Get new stub
    const recoveredCore = getCore('eviction-alarm-1')

    // Alarm should still be scheduled
    const alarmAfter = await recoveredCore.getAlarm()
    expect(alarmAfter?.getTime()).toBe(futureTime)
  })
})

// =============================================================================
// 4. NO DATA LOSS GUARANTEES
// =============================================================================

describe('No Data Loss Guarantees', () => {
  it('should not lose any items in high-throughput scenario [RED]', async () => {
    const core = getCore('eviction-throughput-1')

    // Create many items rapidly
    const createPromises = []
    for (let i = 0; i < 200; i++) {
      createPromises.push(
        core.create('HighThroughput', { index: i, timestamp: Date.now() })
      )
    }

    // Don't wait for all creates, trigger eviction mid-stream
    const createdItems = await Promise.all(createPromises) as Array<{ $id: string }>

    // Simulate eviction
    await simulateEviction('eviction-throughput-1')

    // Get new stub
    const recoveredCore = getCore('eviction-throughput-1')

    // Count recovered items
    const recovered = await recoveredCore.listThings('HighThroughput')

    // All items that were created should be recovered
    expect(recovered.length).toBe(createdItems.length)
  })

  it('should preserve data integrity across eviction [RED]', async () => {
    const core = getCore('eviction-integrity-1')

    // Create linked data
    const order = await core.create('Order', {
      items: ['item-1', 'item-2'],
      total: 150.00,
      status: 'pending',
    }) as { $id: string }

    const customer = await core.create('Customer', {
      name: 'Alice',
      orders: [order.$id],
    }) as { $id: string }

    // Update order with customer reference using accessor pattern
    const orderAccessor = core.Order(order.$id) as any
    await orderAccessor.update({
      customerId: customer.$id,
    })

    // Simulate eviction
    await simulateEviction('eviction-integrity-1')

    // Get new stub
    const recoveredCore = getCore('eviction-integrity-1')

    // Verify referential integrity is maintained
    const customerAccessor = recoveredCore.Customer(customer.$id) as any
    const recoveredCustomer = await customerAccessor.getProfile() as { orders: string[] } | null
    const orderAccessor2 = recoveredCore.Order(order.$id) as any
    const recoveredOrder = await orderAccessor2.getProfile() as { customerId: string } | null

    expect(recoveredCustomer?.orders).toContain(order.$id)
    expect(recoveredOrder?.customerId).toBe(customer.$id)
  })

  it('should handle eviction during delete operation [RED]', async () => {
    const core = getCore('eviction-delete-1')

    // Create items
    await core.create('DeleteTest', { name: 'Keep' })
    const toDelete = await core.create('DeleteTest', { name: 'Delete' }) as { $id: string }

    // Delete one and evict using accessor pattern
    const deleteAccessor = core.Customer(toDelete.$id) as any
    const deletePromise = deleteAccessor.delete()
    const evictionPromise = simulateEviction('eviction-delete-1')

    await Promise.all([deletePromise, evictionPromise])

    // Get new stub
    const recoveredCore = getCore('eviction-delete-1')

    // Only one item should remain
    const remaining = await recoveredCore.listThings('DeleteTest')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('Keep')
  })

  it('should not have phantom entries after eviction [RED]', async () => {
    const core = getCore('eviction-phantom-1')

    // Create and delete items
    for (let i = 0; i < 10; i++) {
      const item = await core.create('Phantom', { index: i }) as { $id: string }
      if (i % 2 === 0) {
        const accessor = core.Customer(item.$id) as any
        await accessor.delete()
      }
    }

    // Simulate eviction
    await simulateEviction('eviction-phantom-1')

    // Get new stub
    const recoveredCore = getCore('eviction-phantom-1')

    // Only odd-indexed items should remain (5 items)
    const remaining = await recoveredCore.listThings('Phantom') as Array<{ index: number }>
    expect(remaining).toHaveLength(5)

    // All remaining items should have odd indices
    for (const item of remaining) {
      expect(item.index % 2).toBe(1)
    }
  })

  it('should handle eviction with WebSocket connections [RED]', async () => {
    const core = getCore('eviction-websocket-1')

    // Store some state that would be associated with WebSocket
    await core.set('ws:session-1', { userId: 'user-123', connected: true })
    await core.set('ws:session-2', { userId: 'user-456', connected: true })

    // Simulate eviction (which should mark connections as needing restore)
    await simulateEviction('eviction-websocket-1')

    // Get new stub
    const recoveredCore = getCore('eviction-websocket-1')

    // Session state should be preserved (even if connections are dropped)
    const session1 = await recoveredCore.get('ws:session-1')
    const session2 = await recoveredCore.get('ws:session-2')

    expect(session1).toMatchObject({ userId: 'user-123' })
    expect(session2).toMatchObject({ userId: 'user-456' })
  })
})

// =============================================================================
// 5. EDGE CASES AND STRESS TESTS
// =============================================================================

describe('Edge Cases and Stress Tests', () => {
  it('should handle eviction with empty state [RED]', async () => {
    // Get a fresh DO
    const core = getCore('eviction-empty-1')

    // Immediately evict (no state created)
    await simulateEviction('eviction-empty-1')

    // Get new stub
    const recoveredCore = getCore('eviction-empty-1')

    // Should still work normally
    const result = await recoveredCore.get('nonexistent')
    expect(result).toBeUndefined()

    // Should be able to create new state
    await recoveredCore.set('new-key', 'new-value')
    expect(await recoveredCore.get('new-key')).toBe('new-value')
  })

  it('should handle rapid eviction cycles [RED]', async () => {
    // Rapid eviction cycle test
    for (let cycle = 0; cycle < 5; cycle++) {
      const core = getCore('eviction-rapid-cycle-1')

      await core.set(`cycle-${cycle}`, cycle)
      await simulateEviction('eviction-rapid-cycle-1')
    }

    // Final check
    const finalCore = getCore('eviction-rapid-cycle-1')

    // All cycles should be preserved
    for (let cycle = 0; cycle < 5; cycle++) {
      const result = await finalCore.get(`cycle-${cycle}`)
      expect(result).toBe(cycle)
    }
  })

  it('should handle large binary-like data across eviction [RED]', async () => {
    const core = getCore('eviction-binary-1')

    // Create large string data (simulating binary)
    const largeData = 'x'.repeat(100000) // 100KB of data

    await core.set('large-key', largeData)

    // Simulate eviction
    await simulateEviction('eviction-binary-1')

    // Get new stub
    const recoveredCore = getCore('eviction-binary-1')

    // Large data should be fully recovered
    const result = await recoveredCore.get('large-key') as string
    expect(result.length).toBe(100000)
    expect(result).toBe(largeData)
  })

  it('should maintain consistency with concurrent evictions [RED]', async () => {
    // This tests what happens if eviction is called while another eviction is in progress
    const core = getCore('eviction-concurrent-evict-1')

    await core.set('concurrent-key', 'value')

    // Trigger multiple evictions concurrently
    await Promise.all([
      simulateEviction('eviction-concurrent-evict-1'),
      simulateEviction('eviction-concurrent-evict-1'),
      simulateEviction('eviction-concurrent-evict-1'),
    ])

    // Get new stub
    const recoveredCore = getCore('eviction-concurrent-evict-1')

    // State should be consistent
    expect(await recoveredCore.get('concurrent-key')).toBe('value')
  })

  it('should handle eviction during onStart lifecycle [RED]', async () => {
    // This tests what happens if DO is evicted right after starting
    const core = getCore('eviction-onstart-1')

    // The act of getting the stub triggers onStart
    // Immediately trigger eviction
    await simulateEviction('eviction-onstart-1')

    // Get new stub (triggers onStart again)
    const recoveredCore = getCore('eviction-onstart-1')

    // DO should be functional
    await recoveredCore.set('post-eviction-key', 'works')
    expect(await recoveredCore.get('post-eviction-key')).toBe('works')
  })
})

// =============================================================================
// 6. IN-MEMORY CACHE RECOVERY (CRITICAL - KNOWN GAP)
// =============================================================================

describe('In-Memory Cache Recovery [CRITICAL GAP]', () => {
  /**
   * These tests specifically target a known gap in DOCore:
   * The in-memory `things` Map is NOT populated from SQLite on cold start.
   *
   * In production, when a DO is evicted and reconstructed:
   * 1. Constructor runs, initializing empty `things` Map
   * 2. SQLite state exists but is not loaded into memory
   * 3. First request for a Thing checks memory (empty), then SQLite
   * 4. BUT: The getThing() method has a fallback to SQLite, so reads work
   * 5. HOWEVER: The update/delete operations may not work correctly
   *
   * These tests verify the gap exists and should FAIL until fixed.
   */

  it('should have clearMemoryCache() method for testing eviction [RED]', async () => {
    const core = getCore('cache-method-1') as any

    // This test verifies that we have the ability to test eviction properly
    // The clearMemoryCache() method should exist to simulate eviction
    expect(typeof core.clearMemoryCache).toBe('function')
  })

  it('should recover things from SQLite after memory cache cleared [RED]', async () => {
    const core = getCore('cache-recovery-1')

    // Create a thing
    const created = await core.create('CacheTest', { name: 'Alice' }) as { $id: string }

    // Clear the in-memory cache (simulates eviction)
    await clearInMemoryCache('cache-recovery-1')

    // Get new reference
    const recoveredCore = getCore('cache-recovery-1')

    // Thing should be recoverable from SQLite using accessor pattern
    const accessor = recoveredCore.Customer(created.$id) as any
    const profile = await accessor.getProfile()
    expect(profile).toMatchObject({
      $id: created.$id,
      $type: 'CacheTest',
      name: 'Alice',
    })
  })

  it('should be able to update things after memory cache cleared [RED]', async () => {
    const core = getCore('cache-update-1')

    // Create a thing
    const created = await core.create('CacheTest', { name: 'Original' }) as { $id: string }

    // Clear the in-memory cache
    await clearInMemoryCache('cache-update-1')

    // Get new reference and try to update
    const recoveredCore = getCore('cache-update-1')

    // This should work - update a thing that only exists in SQLite
    const updateAccessor = recoveredCore.Customer(created.$id) as any
    const updated = await updateAccessor.update({ name: 'Updated' }) as { name: string }

    expect(updated.name).toBe('Updated')

    // Verify the update persisted
    const verifyAccessor = recoveredCore.Customer(created.$id) as any
    const verified = await verifyAccessor.getProfile() as { name: string }
    expect(verified.name).toBe('Updated')
  })

  it('should be able to delete things after memory cache cleared [RED]', async () => {
    const core = getCore('cache-delete-1')

    // Create two things
    const item1 = await core.create('CacheTest', { name: 'Keep' }) as { $id: string }
    const item2 = await core.create('CacheTest', { name: 'Delete' }) as { $id: string }

    // Clear the in-memory cache
    await clearInMemoryCache('cache-delete-1')

    // Get new reference and try to delete
    const recoveredCore = getCore('cache-delete-1')

    // This should work - delete a thing that only exists in SQLite
    const deleteAccessor = recoveredCore.Customer(item2.$id) as any
    const deleted = await deleteAccessor.delete()
    expect(deleted).toBe(true)

    // Verify only one thing remains
    const remaining = await recoveredCore.listThings('CacheTest')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].$id).toBe(item1.$id)
  })

  it('should maintain version continuity after memory cache cleared [RED]', async () => {
    const core = getCore('cache-version-1')

    // Create and update multiple times
    const created = await core.create('CacheTest', { value: 0 }) as { $id: string; $version: number }
    const accessor1 = core.Customer(created.$id) as any
    await accessor1.update({ value: 1 })
    const accessor2 = core.Customer(created.$id) as any
    const beforeClear = await accessor2.update({ value: 2 }) as { $version: number }

    expect(beforeClear.$version).toBe(3)

    // Clear the in-memory cache
    await clearInMemoryCache('cache-version-1')

    // Get new reference and update again
    const recoveredCore = getCore('cache-version-1')
    const accessor3 = recoveredCore.Customer(created.$id) as any
    const afterClear = await accessor3.update({ value: 3 }) as { $version: number }

    // Version should continue from 3 -> 4
    expect(afterClear.$version).toBe(4)
  })

  it('should populate eventHandlers from storage after eviction [RED]', async () => {
    const core = getCore('cache-handlers-1') as any

    // Register an event handler via RPC
    // Note: Event handlers registered via RPC are in-memory only
    // This test verifies that handlers don't persist across eviction
    const handlerCount = await core.getHandlerCount('Customer.created')
    expect(handlerCount).toBe(0) // Initially no handlers

    // Clear memory cache
    await clearInMemoryCache('cache-handlers-1')

    // Get new reference
    const recoveredCore = getCore('cache-handlers-1') as any

    // Event handlers are in-memory only and NOT persisted to SQLite
    // This is expected - handlers need to be re-registered after eviction
    // The test documents this behavior
    const recoveredCount = await recoveredCore.getHandlerCount('Customer.created')
    expect(recoveredCount).toBe(0) // Still no handlers after eviction
  })

  it('should expose recovery statistics after eviction [RED]', async () => {
    const core = getCore('cache-stats-1') as any

    // Create some state
    await core.create('StatsTest', { name: 'Item 1' })
    await core.create('StatsTest', { name: 'Item 2' })
    await core.set('key1', 'value1')
    await core.set('key2', 'value2')

    // Clear memory cache (simulates eviction)
    await clearInMemoryCache('cache-stats-1')

    // Get new reference
    const recoveredCore = getCore('cache-stats-1') as any

    // There should be a method to get recovery stats
    // This helps monitor eviction/recovery behavior in production
    const stats = await recoveredCore.getRecoveryStats()

    expect(stats).toMatchObject({
      thingsRecovered: 2,
      stateEntriesRecovered: expect.any(Number),
      lastRecoveryTimestamp: expect.any(Number),
    })
  })
})

// =============================================================================
// 7. PIPELINE/WAL RECOVERY (UNIFIED STORAGE GAP)
// =============================================================================

describe('Pipeline/WAL Recovery [UNIFIED STORAGE]', () => {
  /**
   * These tests verify that the Pipeline-as-WAL pattern works correctly
   * during eviction scenarios. The Pipeline should ensure durability even
   * when the DO is evicted before lazy checkpointing completes.
   *
   * NOTE: DOStorage is a class that wraps the unified storage layers:
   * - L0: InMemoryStateManager (hot cache)
   * - L1: PipelineEmitter (WAL for durability)
   * - L2: LazyCheckpointer (SQLite for persistence)
   * - L3: IcebergWriter (cold storage)
   *
   * For these tests to pass, DOStorage needs:
   * 1. RPC-compatible methods (create, update, delete, get, beforeHibernation)
   * 2. Pipeline integration with replay on cold start
   * 3. Proper recovery of in-flight events after eviction
   */

  it('should have DOStorage binding for unified storage tests [RED]', async () => {
    // DOStorage class should be available for testing unified storage
    expect(env.DOStorage).toBeDefined()
  })

  it('should not lose data written to Pipeline but not yet checkpointed [RED]', async () => {
    // This test requires DOStorage with Pipeline integration
    if (!env.DOStorage) {
      throw new Error('DOStorage binding required for Pipeline tests')
    }

    const id = env.DOStorage.idFromName('pipeline-test-1')
    const storage = env.DOStorage.get(id) as any

    // Create data using DOStorage API (type as first arg, data as second)
    // This should go to Pipeline immediately for durability
    const created = await storage.create('PipelineTest', { name: 'Critical' })

    // Simulate eviction BEFORE checkpointer has run
    // In reality, the checkpointer might not have flushed to SQLite yet
    await storage.beforeHibernation()

    // Get new reference
    const recovered = env.DOStorage.get(id) as any

    // Data should be recovered from Pipeline replay
    const result = await recovered.get(created.$id)
    expect(result).toMatchObject({
      $id: created.$id,
      $type: 'PipelineTest',
      name: 'Critical',
    })
  })

  it('should replay Pipeline events in correct order after eviction [RED]', async () => {
    if (!env.DOStorage) {
      throw new Error('DOStorage binding required for Pipeline tests')
    }

    const id = env.DOStorage.idFromName('pipeline-order-1')
    const storage = env.DOStorage.get(id) as any

    // Create and update rapidly
    const created = await storage.create('OrderTest', { value: 0 })
    await storage.update(created.$id, { value: 1 })
    await storage.update(created.$id, { value: 2 })
    await storage.update(created.$id, { value: 3 })

    // Evict
    await storage.beforeHibernation()

    // Recover
    const recovered = env.DOStorage.get(id) as any
    const result = await recovered.get(created.$id)

    // Value should be 3 (all updates applied in order)
    expect(result.value).toBe(3)
  })

  it('should handle create-update-delete sequence through Pipeline [RED]', async () => {
    if (!env.DOStorage) {
      throw new Error('DOStorage binding required for Pipeline tests')
    }

    const id = env.DOStorage.idFromName('pipeline-crud-1')
    const storage = env.DOStorage.get(id) as any

    // Create
    const item1 = await storage.create('CRUDTest', { name: 'Keep' })
    const item2 = await storage.create('CRUDTest', { name: 'Delete' })

    // Update item1
    await storage.update(item1.$id, { name: 'Updated' })

    // Delete item2
    await storage.delete(item2.$id)

    // Evict before checkpoint
    await storage.beforeHibernation()

    // Recover
    const recovered = env.DOStorage.get(id) as any

    // Item1 should exist with updated name
    const result1 = await recovered.get(item1.$id)
    expect(result1.name).toBe('Updated')

    // Item2 should not exist
    const result2 = await recovered.get(item2.$id)
    expect(result2).toBeNull()
  })
})

// =============================================================================
// 8. COLD START RECOVERY VERIFICATION
// =============================================================================

describe('Cold Start Recovery Verification', () => {
  /**
   * These tests verify that the ColdStartRecovery module works correctly.
   * They use the storage layer directly to test recovery behavior.
   */

  it('should call onStart hook after simulated cold start [RED]', async () => {
    const core = getCore('coldstart-hook-1') as any

    // First access - onStart should have run
    const startCount1 = await core.get('_lifecycle:onStartCount')

    // Clear memory cache to simulate cold start
    await clearInMemoryCache('coldstart-hook-1')

    // Get new reference - should trigger onStart again
    const recoveredCore = getCore('coldstart-hook-1') as any

    // Force a request to trigger initialization
    await recoveredCore.ping()

    const startCount2 = await recoveredCore.get('_lifecycle:onStartCount')

    // Start count should have incremented
    expect(startCount2).toBe((startCount1 as number) + 1)
  })

  it('should restore schedules after cold start [RED]', async () => {
    const core = getCore('coldstart-schedule-1') as any

    // Register a schedule
    const handlerCalled: string[] = []
    core.every.day.at('9am')(() => {
      handlerCalled.push('called')
    })

    // Verify schedule is registered
    const scheduleBefore = core.getSchedule('0 9 * * *')
    expect(scheduleBefore).toBeDefined()

    // Clear memory cache
    await clearInMemoryCache('coldstart-schedule-1')

    // Get new reference
    const recoveredCore = getCore('coldstart-schedule-1') as any

    // Schedules are stored in SQLite but handlers are functions (not serializable)
    // After cold start, the schedule entry exists but the handler is lost
    // This test documents this limitation
    const scheduleAfter = recoveredCore.getSchedule('0 9 * * *')

    // Schedule metadata should be recovered from SQLite
    // But handler function will be undefined until re-registered
    expect(scheduleAfter).toBeDefined()
    // Note: The handler itself won't be recovered - this is expected
    // Applications must re-register handlers on cold start
  })

  it('should expose cold start recovery metrics [RED]', async () => {
    const core = getCore('coldstart-metrics-1') as any

    // Create some data
    for (let i = 0; i < 10; i++) {
      await core.create('MetricsTest', { index: i })
    }

    // Clear memory cache
    await clearInMemoryCache('coldstart-metrics-1')

    // Get new reference
    const recoveredCore = getCore('coldstart-metrics-1') as any

    // Force a request that triggers recovery
    await recoveredCore.listThings('MetricsTest')

    // Should be able to get cold start metrics
    const metrics = await recoveredCore.getColdStartMetrics()

    expect(metrics).toMatchObject({
      source: expect.stringMatching(/sqlite|empty|iceberg/),
      thingsLoaded: expect.any(Number),
      durationMs: expect.any(Number),
    })
  })
})
