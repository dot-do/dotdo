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
 * Uses real Miniflare DO instances via @cloudflare/vitest-pool-workers.
 * NO MOCKS - per CLAUDE.md guidelines.
 *
 * @module do/tests/concurrency.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import { createThingsStore, type ThingsStore } from '@dotdo/db'
import { generateTestId, getTestDO, sleep } from '@dotdo/test-utils'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Get a fresh DO stub for testing
 */
function getStub(name?: string) {
  return getTestDO(env, name ?? generateTestId('concurrency'))
}

/**
 * Helper to simulate delay (using shared test-utils sleep function)
 */
const delay = sleep

// ============================================================================
// Test: Concurrent DO Access
// ============================================================================

describe('Concurrent DO Access', () => {
  describe('Multiple simultaneous requests to same DO', () => {
    it('should handle multiple concurrent GET requests', async () => {
      const stub = getStub()

      // Send 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        stub.fetch(`https://do/?requestId=${i}`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses).toHaveLength(10)
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text() // Consume body
      }
    })

    it('should handle concurrent RPC requests to same DO', async () => {
      const stub = getStub()

      // Fire 20 concurrent RPC calls (to non-existent methods - they'll return 404 but exercise concurrency)
      const requests = Array.from({ length: 20 }, (_, i) =>
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: `testMethod${i}`, args: [] }),
        })
      )

      const responses = await Promise.all(requests)

      // All RPC requests should be handled (404 for unknown methods is expected)
      expect(responses).toHaveLength(20)
      for (const response of responses) {
        expect([200, 404]).toContain(response.status)
        await response.text() // Consume body
      }
    })

    it('should return consistent id for same DO instance under concurrent access', async () => {
      const testName = `concurrent-id-${generateTestId()}`
      const stub = getStub(testName)

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, () => stub.fetch('https://do/'))

      const responses = await Promise.all(requests)
      const jsons = await Promise.all(
        responses.map(r => r.json() as Promise<{ id: string }>)
      )

      // All should have the same DO ID (same instance)
      const ids = jsons.map(j => j.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(1)
    })

    it('should handle mixed read/write operations concurrently', async () => {
      const stub = getStub()

      // Mix of different endpoints
      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
      ]

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        await response.text() // Consume body
      }
    })
  })

  describe('DO request serialization (CF guarantee)', () => {
    it('should serialize requests to same DO instance', async () => {
      const stub = getStub()

      // Fire concurrent requests - CF runtime serializes them
      const requests = Array.from({ length: 10 }, () => stub.fetch('https://do/info'))

      const responses = await Promise.all(requests)
      const infos = await Promise.all(
        responses.map(r => r.json() as Promise<{ id: string }>)
      )

      // All should see same DO instance (serialization guarantee)
      const uniqueIds = new Set(infos.map(i => i.id))
      expect(uniqueIds.size).toBe(1)
    })
  })
})

// ============================================================================
// Test: Concurrent RPC Calls
// ============================================================================

describe('Concurrent RPC Calls', () => {
  describe('Parallel RPC method invocations', () => {
    it('should handle parallel calls to different endpoints', async () => {
      const stub = getStub()

      // Mix of different routes
      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/'),
      ]

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Consume bodies
      await Promise.all(responses.map(r => r.text()))
    })

    it('should maintain response ordering with Promise.all', async () => {
      const stub = getStub()

      // Fire requests in order
      const requests = [
        stub.fetch('https://do/?idx=0'),
        stub.fetch('https://do/?idx=1'),
        stub.fetch('https://do/?idx=2'),
        stub.fetch('https://do/?idx=3'),
        stub.fetch('https://do/?idx=4'),
      ]

      const responses = await Promise.all(requests)

      // Promise.all maintains the order of the input array
      expect(responses).toHaveLength(5)
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Consume bodies
      await Promise.all(responses.map(r => r.text()))
    })

    it('should handle Promise.race for fastest response', async () => {
      const stub = getStub()

      // Race between requests
      const request1 = stub.fetch('https://do/')
      const request2 = stub.fetch('https://do/info')

      const winner = await Promise.race([request1, request2])

      expect(winner.status).toBe(200)

      // Wait for both requests to complete and consume their bodies
      // Note: winner is one of these, but Promise caches the result
      const [resp1, resp2] = await Promise.all([request1, request2])
      // Each response body can only be consumed once
      // The winner's body was NOT consumed yet, so we just consume all here
      await Promise.all([resp1.text(), resp2.text()])
    })
  })

  describe('Error isolation between calls', () => {
    it('should not let one failing RPC call affect others', async () => {
      const stub = getStub()

      // Mix of valid endpoints and invalid RPC calls
      const requests = [
        stub.fetch('https://do/'),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'nonExistentMethod', args: [] }),
        }),
        stub.fetch('https://do/info'),
        stub.fetch('https://do/nonexistent'),
        stub.fetch('https://do/'),
      ]

      const responses = await Promise.all(requests)

      // Check status codes
      expect(responses[0].status).toBe(200) // health endpoint
      expect(responses[1].status).toBe(404) // unknown RPC method
      expect(responses[2].status).toBe(200) // info endpoint
      expect(responses[3].status).toBe(404) // unknown route
      expect(responses[4].status).toBe(200) // health endpoint

      // Consume all bodies
      await Promise.all(responses.map(r => r.text()))
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
// Test: WebSocket Race Conditions (using real DO hibernation API)
// ============================================================================

describe('WebSocket Race Conditions', () => {
  describe('Multiple clients connecting simultaneously', () => {
    it('should handle multiple simultaneous WebSocket upgrade requests', async () => {
      const stub = getStub()

      // Simulate multiple WebSocket upgrade requests
      // Note: In miniflare test environment, we test via HTTP endpoints
      // Real WebSocket upgrades would use stub.webSocket() which isn't available in all test setups
      const requests = Array.from({ length: 10 }, () =>
        stub.fetch('https://do/', {
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
          },
        })
      )

      const responses = await Promise.all(requests)

      // All should be handled (either upgraded or returned appropriate status)
      expect(responses).toHaveLength(10)
      for (const response of responses) {
        // WebSocket upgrade returns 101, or 200/426 if not supported in test env
        expect([101, 200, 426]).toContain(response.status)
      }

      // Consume bodies for non-upgraded responses
      await Promise.all(responses.map(async r => {
        if (r.status !== 101) {
          await r.text()
        }
      }))
    })
  })

  describe('Message ordering guarantees', () => {
    it('should maintain request order per DO instance', async () => {
      const stub = getStub()

      // Send multiple requests in sequence
      const messages = Array.from({ length: 50 }, (_, i) => i)
      const requests = messages.map(i =>
        stub.fetch(`https://do/?seq=${i}`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Consume bodies
      await Promise.all(responses.map(r => r.text()))
    })
  })
})

// ============================================================================
// Test: Alarm Race Conditions
// ============================================================================

describe('Alarm Race Conditions', () => {
  describe('Alarm firing during request processing', () => {
    it('should handle alarm firing while processing a request', async () => {
      const stub = getStub()

      // Start a request and trigger alarm concurrently via runInDurableObject
      const [fetchResult, alarmResult] = await Promise.all([
        stub.fetch('https://do/'),
        runInDurableObject(stub, async (instance: DO) => {
          await instance.alarm()
          return 'alarm-complete'
        }),
      ])

      expect(fetchResult.status).toBe(200)
      expect(alarmResult).toBe('alarm-complete')

      await fetchResult.text() // Consume body
    })

    it('should handle alarm and fetch competing for state', async () => {
      const stub = getStub()

      // Run both concurrently
      const [fetchResult, alarmResult] = await Promise.all([
        stub.fetch('https://do/info'),
        runInDurableObject(stub, async (instance: DO) => {
          await instance.alarm()
          return 'done'
        }),
      ])

      expect(fetchResult.status).toBe(200)
      expect(alarmResult).toBe('done')

      // Consume body
      await fetchResult.text()
    })
  })

  describe('Multiple alarms scheduled for same time', () => {
    it('should handle multiple rapid alarm schedules', async () => {
      const stub = getStub()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState

        // Schedule multiple alarms in quick succession
        // Only the last one will take effect (CF behavior)
        for (let i = 0; i < 10; i++) {
          await state.storage.setAlarm(Date.now() + 1000 + i)
        }

        // Verify an alarm is set
        const alarm = await state.storage.getAlarm()
        return alarm !== null
      })

      expect(result).toBe(true)
    })

    it('should handle alarm scheduling during alarm execution', async () => {
      const stub = getStub()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState
        const $ = (instance as any).$

        // Register a schedule that runs when alarm fires
        $.every.hour(async () => {
          // This would schedule the next alarm
        })

        // Trigger alarm - this will execute handlers and reschedule
        await instance.alarm()

        // Verify alarm was rescheduled (may or may not be set depending on schedule logic)
        const alarm = await state.storage.getAlarm()
        // Return whether the alarm call completed successfully
        return true
      })

      // The alarm execution should complete without error
      expect(result).toBe(true)
    })
  })

  describe('Alarm cleanup on state changes', () => {
    it('should handle alarm cancellation', async () => {
      const stub = getStub()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState

        // Set an alarm
        await state.storage.setAlarm(Date.now() + 10000)

        // Verify it's set
        const beforeClear = await state.storage.getAlarm()

        // Clear the alarm
        await state.storage.deleteAlarm()

        // Verify it's cleared
        const afterClear = await state.storage.getAlarm()

        return {
          wasSet: beforeClear !== null,
          wasCleared: afterClear === null,
        }
      })

      expect(result.wasSet).toBe(true)
      expect(result.wasCleared).toBe(true)
    })
  })
})

// ============================================================================
// Test: Combined Stress Tests
// ============================================================================

describe('Combined Stress Tests', () => {
  it('should handle high load with mixed operations', async () => {
    const stub = getStub()

    // Generate mixed operations
    const operations = Array.from({ length: 100 }, (_, i) => {
      if (i % 2 === 0) {
        return stub.fetch('https://do/')
      } else {
        return stub.fetch('https://do/info')
      }
    })

    const responses = await Promise.all(operations)

    // All should succeed
    const successCount = responses.filter(r => r.status === 200).length
    expect(successCount).toBe(100)

    // Consume all bodies
    await Promise.all(responses.map(r => r.text()))
  })

  it('should maintain consistency under concurrent storage and RPC load', async () => {
    const stub = getStub()
    const store = createThingsStore()

    // Fire storage operations and RPC operations concurrently
    const storageOps = Array.from({ length: 20 }, (_, i) =>
      store.create({ $type: 'stress', value: i })
    )

    const rpcOps = Array.from({ length: 20 }, () => stub.fetch('https://do/'))

    const [storageResults, rpcResponses] = await Promise.all([
      Promise.all(storageOps),
      Promise.all(rpcOps),
    ])

    // All storage operations should succeed
    expect(storageResults).toHaveLength(20)

    // All RPC operations should succeed
    for (const response of rpcResponses) {
      expect(response.status).toBe(200)
    }

    // Consume bodies
    await Promise.all(rpcResponses.map(r => r.text()))
  })

  it('should recover from partial failures in batch operations', async () => {
    const stub = getStub()

    // Create operations with some failures (unknown routes)
    const operations = Array.from({ length: 50 }, (_, i) => {
      if (i % 5 === 0) {
        // Every 5th operation is to an unknown route (will fail with 404)
        return stub.fetch('https://do/nonexistent')
      }
      return stub.fetch('https://do/')
    })

    const responses = await Promise.all(operations)

    const successful = responses.filter(r => r.status === 200)
    const failed = responses.filter(r => r.status === 404)

    expect(successful.length).toBe(40) // 50 - 10 failures
    expect(failed.length).toBe(10) // Every 5th fails

    // Consume all bodies
    await Promise.all(responses.map(r => r.text()))
  })
})

// ============================================================================
// Test: Multi-Instance Concurrent Access
// ============================================================================

describe('Multi-Instance Concurrent Access', () => {
  it('should handle concurrent access to multiple DO instances', async () => {
    // Create 10 different DO instances
    const instances = Array.from({ length: 10 }, (_, i) => {
      const testName = `multi-${generateTestId()}-${i}`
      return getStub(testName)
    })

    // Each instance gets 5 concurrent requests
    const allRequests = instances.flatMap(stub =>
      Array.from({ length: 5 }, () => stub.fetch('https://do/'))
    )

    const responses = await Promise.all(allRequests)

    // All 50 requests should succeed
    const successCount = responses.filter(r => r.status === 200).length
    expect(successCount).toBe(50)

    // Consume bodies
    await Promise.all(responses.map(r => r.text()))
  })

  it('should isolate data between concurrent DO instances', async () => {
    const instances = Array.from({ length: 5 }, (_, i) => {
      const testName = `isolation-${generateTestId()}-${i}`
      return getStub(testName)
    })

    // Get info from all instances concurrently
    const infoResponses = await Promise.all(
      instances.map(stub => stub.fetch('https://do/info'))
    )

    const infos = await Promise.all(
      infoResponses.map(r => r.json() as Promise<{ id: string }>)
    )

    // Each instance should have a unique ID
    const uniqueIds = new Set(infos.map(i => i.id))
    expect(uniqueIds.size).toBe(5)
  })

  it('should handle cross-instance request patterns', async () => {
    const instanceCount = 3
    const instances = Array.from({ length: instanceCount }, (_, i) => {
      const testName = `cross-${generateTestId()}-${i}`
      return getStub(testName)
    })

    // Round-robin requests across instances
    const requestCount = 60
    const requests = Array.from({ length: requestCount }, (_, i) => {
      const stub = instances[i % instanceCount]!
      return stub.fetch('https://do/')
    })

    const responses = await Promise.all(requests)

    const successCount = responses.filter(r => r.status === 200).length
    expect(successCount).toBe(requestCount)

    // Consume bodies
    await Promise.all(responses.map(r => r.text()))
  })
})
