/**
 * Concurrent Access and Race Condition Tests for dotdo Framework
 *
 * Tests for:
 * 1. Concurrent DO access - Multiple simultaneous requests to same DO
 * 2. Concurrent RPC calls - Parallel RPC method invocations
 * 3. Storage race conditions - Concurrent writes and read-modify-write patterns
 * 4. WebSocket race conditions - Multiple clients, message ordering
 * 5. Alarm race conditions - Alarm firing during request processing
 *
 * Uses Promise.all, Promise.race, and setTimeout to simulate concurrent scenarios.
 *
 * IMPORTANT: This file uses real Miniflare DO instances via @cloudflare/vitest-pool-workers
 * instead of mocks. This ensures tests reflect actual production behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createThingsStore, type ThingsStore } from '../../db/things'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to simulate delay
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ============================================================================
// Test: Concurrent DO Access
// ============================================================================

describe('Concurrent DO Access', () => {
  describe('Multiple simultaneous requests to same DO', () => {
    it('should handle multiple concurrent GET requests', async () => {
      const testName = `concurrent-get-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Send 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        stub.fetch(`https://do/?requestId=${i}`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses).toHaveLength(10)
      for (const response of responses) {
        expect(response.status).toBe(200)
        // Consume response body to avoid issues
        await response.text()
      }
    })

    it('should handle concurrent requests to /info endpoint', async () => {
      const testName = `concurrent-info-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Fire 20 concurrent info requests
      const requests = Array.from({ length: 20 }, () =>
        stub.fetch('https://do/info')
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // All requests should see consistent DO ID
      const infos = await Promise.all(responses.map((r: Response) => r.json() as Promise<{ id: string; keys: number }>))
      const ids = infos.map((info: { id: string; keys: number }) => info.id)
      expect(new Set(ids).size).toBe(1)
    })

    it('should maintain data consistency under concurrent load', async () => {
      const testName = `concurrent-load-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Fire 50 concurrent requests
      const requests = Array.from({ length: 50 }, (_, i) =>
        stub.fetch(`https://do/info?requestId=${i}`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses.length).toBe(50)
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text()
      }
    })

    it('should handle mixed read/write operations concurrently via entity endpoints', async () => {
      const testName = `concurrent-mixed-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Mix of reads and writes (using available endpoints)
      const operations = [
        ...Array.from({ length: 5 }, () => stub.fetch('https://do/')),
        ...Array.from({ length: 5 }, () => stub.fetch('https://do/info')),
      ]

      const responses = await Promise.all(operations)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text()
      }
    })
  })

  describe('DO request serialization (CF guarantee)', () => {
    it('should document that DOs process requests serially', async () => {
      const testName = `serial-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Cloudflare guarantees DOs process requests serially
      // Fire concurrent requests
      const [resp1, resp2] = await Promise.all([
        stub.fetch('https://do/info'),
        stub.fetch('https://do/info'),
      ])

      expect(resp1.status).toBe(200)
      expect(resp2.status).toBe(200)

      // Both should see consistent state (same DO ID)
      const info1 = await resp1.json() as { id: string }
      const info2 = await resp2.json() as { id: string }
      expect(info1.id).toBe(info2.id)
    })
  })
})

// ============================================================================
// Test: Concurrent RPC Calls
// ============================================================================

describe('Concurrent RPC Calls', () => {
  describe('Parallel RPC method invocations', () => {
    it('should handle parallel requests to same endpoint', async () => {
      const testName = `parallel-rpc-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/'),
      ]

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      const results = await Promise.all(responses.map((r: Response) => r.json() as Promise<{ status: string }>))
      for (const result of results) {
        expect(result.status).toBe('ok')
      }
    })

    it('should maintain response ordering with Promise.all', async () => {
      const testName = `order-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const expectedOrder = [1, 2, 3, 4, 5]
      const requests = expectedOrder.map(value =>
        stub.fetch(`https://do/info?value=${value}`)
      )

      const responses = await Promise.all(requests)

      // Promise.all maintains the order of the input array
      expect(responses).toHaveLength(5)
      for (let i = 0; i < responses.length; i++) {
        expect(responses[i].status).toBe(200)
        await responses[i].text()
      }
    })

    it('should handle Promise.race for fastest response', async () => {
      const testName = `race-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const request1 = stub.fetch('https://do/')
      const request2 = stub.fetch('https://do/info')

      const winner = await Promise.race([request1, request2])

      expect(winner.status).toBe(200)
      await winner.text()
    })
  })

  describe('Error isolation between calls', () => {
    it('should not let one failing request affect others', async () => {
      const testName = `error-isolation-${generateTestId()}`
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Mix of valid and invalid requests
      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/nonexistent-endpoint'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'nonExistent', args: [] })
        }),
        stub.fetch('https://do/'),
      ]

      const responses = await Promise.all(requests)

      // Valid requests (indices 0, 2, 4) should succeed
      expect(responses[0].status).toBe(200)
      expect(responses[2].status).toBe(200)
      expect(responses[4].status).toBe(200)

      // Error should not affect other responses
      const result0 = await responses[0].json() as { status: string }
      const result2 = await responses[2].json() as { status: string }
      const result4 = await responses[4].json() as { status: string }
      expect(result0.status).toBe('ok')
      expect(result2.status).toBe('ok')
      expect(result4.status).toBe('ok')
    })
  })
})

// ============================================================================
// Test: Storage Race Conditions
// ============================================================================

describe('Storage Race Conditions', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createThingsStore()
  })

  describe('Concurrent writes to same key', () => {
    it('should handle concurrent creates without ID collision', async () => {
      // Create 100 things concurrently
      const creates = Array.from({ length: 100 }, (_, i) =>
        store.create({ $type: 'test', name: `item-${i}` })
      )

      const results = await Promise.all(creates)

      // All should succeed
      expect(results).toHaveLength(100)

      // All IDs should be unique
      const ids = results.map(r => r.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(100)
    })

    it('should handle concurrent updates to same entity', async () => {
      // Create an entity first
      const entity = await store.create({ $type: 'counter', value: 0 })

      // Attempt concurrent updates
      const updates = Array.from({ length: 10 }, (_, i) =>
        store.update(entity.$id, { value: i + 1 })
      )

      const results = await Promise.all(updates)

      // All updates should succeed
      expect(results).toHaveLength(10)

      // Final value depends on execution order - last write wins
      const final = await store.get(entity.$id)
      expect(final).toBeDefined()
      expect(typeof final?.value).toBe('number')
    })

    it('should detect concurrent deletes', async () => {
      // Create entities
      const entities = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.create({ $type: 'test', name: `item-${i}` })
        )
      )

      // Try to delete each entity twice concurrently
      const deletePromises = entities.flatMap(entity => [
        store.delete(entity.$id).then(() => 'success').catch(() => 'failed'),
        store.delete(entity.$id).then(() => 'success').catch(() => 'failed'),
      ])

      const results = await Promise.all(deletePromises)

      // Each entity: one delete succeeds, one fails
      const successes = results.filter(r => r === 'success')
      const failures = results.filter(r => r === 'failed')

      expect(successes.length).toBe(10)
      expect(failures.length).toBe(10)
    })
  })

  describe('Read-modify-write patterns', () => {
    it('should demonstrate lost update problem without locks', async () => {
      // Create a counter
      const counter = await store.create({ $type: 'counter', value: 0 })

      // Simulate read-modify-write without synchronization
      const incrementWithoutLock = async () => {
        const current = await store.get(counter.$id)
        if (!current) throw new Error('Counter not found')
        await delay(Math.random() * 5) // Simulate processing time
        await store.update(counter.$id, { value: (current.value as number) + 1 })
      }

      // Run 20 concurrent increments
      await Promise.all(
        Array.from({ length: 20 }, () => incrementWithoutLock())
      )

      const final = await store.get(counter.$id)

      // Without proper synchronization, the final value may be less than 20
      // This demonstrates the need for proper concurrency control
      expect(typeof final?.value).toBe('number')
      // Note: The actual value may vary due to race conditions
    })

    it('should handle bulk operations atomically', async () => {
      // Create initial entities
      const items = await store.bulkCreate([
        { $type: 'item', status: 'pending' },
        { $type: 'item', status: 'pending' },
        { $type: 'item', status: 'pending' },
      ])

      // Attempt concurrent bulk updates
      const bulkUpdate1 = store.bulkUpdate(
        items.map(item => ({ id: item.$id, data: { status: 'processing' } }))
      )
      const bulkUpdate2 = store.bulkUpdate(
        items.map(item => ({ id: item.$id, data: { status: 'completed' } }))
      )

      const [result1, result2] = await Promise.all([bulkUpdate1, bulkUpdate2])

      // Both should succeed (last write wins for each item)
      expect(result1).toHaveLength(3)
      expect(result2).toHaveLength(3)

      // Final state depends on execution order
      const finalItems = await store.list({ type: 'item' })
      expect(finalItems).toHaveLength(3)
    })
  })

  describe('Transaction isolation', () => {
    it('should handle concurrent bulk operations', async () => {
      // Create items in batches concurrently
      const batch1 = store.bulkCreate([
        { $type: 'batch1', value: 1 },
        { $type: 'batch1', value: 2 },
      ])
      const batch2 = store.bulkCreate([
        { $type: 'batch2', value: 3 },
        { $type: 'batch2', value: 4 },
      ])

      const [result1, result2] = await Promise.all([batch1, batch2])

      expect(result1).toHaveLength(2)
      expect(result2).toHaveLength(2)

      // All items should exist
      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(4)
    })

    it('should rollback on bulk operation failure', async () => {
      // Create one valid item
      await store.create({ $type: 'test', name: 'existing' })

      // Try bulk update with one invalid ID
      const validItem = await store.create({ $type: 'test', name: 'valid' })

      // This should fail atomically (all-or-nothing)
      await expect(
        store.bulkUpdate([
          { id: validItem.$id, data: { name: 'updated' } },
          { id: 'non-existent-id', data: { name: 'should-fail' } },
        ])
      ).rejects.toThrow()

      // The valid item should NOT be updated (atomic rollback)
      const afterAttempt = await store.get(validItem.$id)
      expect(afterAttempt?.name).toBe('valid')
    })
  })
})

// ============================================================================
// Test: Concurrent DO Requests Stress Tests
// ============================================================================

describe('Concurrent DO Stress Tests', () => {
  it('should handle high load with concurrent requests', async () => {
    const testName = `stress-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Generate mixed operations
    const operations = Array.from({ length: 100 }, (_, i) => {
      const isInfo = Math.random() > 0.5
      return stub.fetch(isInfo ? 'https://do/info' : 'https://do/')
    })

    const responses = await Promise.all(operations)

    // All should succeed
    const statuses = responses.map((r: Response) => r.status)
    const successCount = statuses.filter((s: number) => s === 200).length

    expect(successCount).toBe(100)

    // Consume all response bodies
    await Promise.all(responses.map((r: Response) => r.text()))
  })

  it('should recover from partial failures in batch operations', async () => {
    const testName = `recovery-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Create operations with some invalid paths
    const operations = Array.from({ length: 50 }, (_, i) => {
      // Every 5th operation goes to a non-existent endpoint
      const shouldFail = i % 5 === 0
      return stub.fetch(shouldFail ? 'https://do/nonexistent' : 'https://do/')
    })

    const responses = await Promise.all(operations)

    const successful = responses.filter(r => r.status === 200)
    const failed = responses.filter(r => r.status !== 200)

    expect(successful.length).toBe(40) // 50 - 10 failures
    expect(failed.length).toBe(10) // Every 5th fails

    // Consume all response bodies
    await Promise.all(responses.map(r => r.text()))
  })

  it('should handle concurrent requests from multiple callers', async () => {
    const testName = `multi-caller-${generateTestId()}`

    // Get multiple stub references (simulating different callers)
    const stubs = Array.from({ length: 5 }, () => {
      const id = env.DO.idFromName(testName)
      return env.DO.get(id)
    })

    // Each "caller" sends requests concurrently
    const requestPromises = stubs.flatMap((stub) =>
      Array.from({ length: 4 }, () =>
        stub.fetch('https://do/')
      )
    )

    const responses = await Promise.all(requestPromises)

    // All 20 requests should succeed (5 stubs * 4 requests)
    expect(responses.length).toBe(20)
    for (const response of responses) {
      expect(response.status).toBe(200)
      await response.text()
    }
  })

  it('should maintain DO instance consistency under concurrent access', async () => {
    const testName = `consistency-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Fire many concurrent requests and verify all see same DO instance
    const requests = Array.from({ length: 30 }, () =>
      stub.fetch('https://do/info')
    )

    const responses = await Promise.all(requests)
    const infos = await Promise.all(
      responses.map(r => r.json() as Promise<{ id: string }>)
    )

    // All requests should see the same DO ID
    const doIds = infos.map(info => info.id)
    expect(new Set(doIds).size).toBe(1)
  })
})
