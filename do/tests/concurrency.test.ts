/**
 * Concurrent Access and Race Condition Tests for dotdo Framework
 *
 * Uses REAL Miniflare runtime - NO MOCKS for DO storage/state per CLAUDE.md philosophy.
 *
 * Tests for:
 * 1. Concurrent DO access - Multiple simultaneous requests to same DO
 * 2. Concurrent RPC calls - Parallel RPC method invocations
 * 3. Storage race conditions - Concurrent writes and read-modify-write patterns
 * 4. Data consistency under load
 *
 * Uses Promise.all, Promise.race, and setTimeout to simulate concurrent scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Helper to generate unique test IDs for isolation
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Helper to get DO stub
function getDoStub(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// Helper for RPC calls
async function rpcCall(stub: DurableObjectStub, method: string, args: unknown[] = []) {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  return response
}

// Helper to simulate delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ============================================================================
// Test: Concurrent DO Access
// ============================================================================

describe('Concurrent DO Access', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('Multiple simultaneous requests to same DO', () => {
    it('should handle multiple concurrent GET requests', async () => {
      const stub = getDoStub(testId)

      // Send 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        stub.fetch(`https://do/?requestId=${i}`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses).toHaveLength(10)
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })
    })

    it('should handle concurrent entity creation', async () => {
      const stub = getDoStub(testId)

      // Fire 20 concurrent creates
      const requests = Array.from({ length: 20 }, (_, i) =>
        rpcCall(stub, 'things.create', [{ $type: 'Item', name: `item-${i}`, index: i }])
      )

      const responses = await Promise.all(requests)

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })

      // All items should have been created
      const listRes = await rpcCall(stub, 'things.list', [{ $type: 'Item' }])
      const items = await listRes.json() as Array<{ $id: string }>
      expect(items).toHaveLength(20)

      // All IDs should be unique
      const ids = items.map(item => item.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(20)
    })

    it('should maintain data consistency under concurrent load', async () => {
      const stub = getDoStub(testId)

      // Create initial entity
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Counter', value: 0 }])
      const created = await createRes.json() as { $id: string }

      // Fire 10 concurrent updates
      const updates = Array.from({ length: 10 }, (_, i) =>
        rpcCall(stub, 'things.update', [created.$id, { value: i + 1 }])
      )

      const responses = await Promise.all(updates)

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })

      // Final value should be one of the update values
      const getRes = await rpcCall(stub, 'things.get', [created.$id])
      const final = await getRes.json() as { value: number }
      expect(final.value).toBeGreaterThanOrEqual(1)
      expect(final.value).toBeLessThanOrEqual(10)
    })

    it('should handle mixed read/write operations concurrently', async () => {
      const stub = getDoStub(testId)

      // Create some initial data
      const createOps = Array.from({ length: 5 }, (_, i) =>
        rpcCall(stub, 'things.create', [{ $type: 'Data', key: `key-${i}`, value: i }])
      )
      await Promise.all(createOps)

      // Mix of reads and writes
      const readOps = Array.from({ length: 10 }, () =>
        rpcCall(stub, 'things.list', [{ $type: 'Data' }])
      )

      const writeOps = Array.from({ length: 10 }, (_, i) =>
        rpcCall(stub, 'things.create', [{ $type: 'Data', key: `extra-${i}`, value: i + 100 }])
      )

      const responses = await Promise.all([...readOps, ...writeOps])

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
      })

      // Final list should have all items
      const finalList = await rpcCall(stub, 'things.list', [{ $type: 'Data' }])
      const items = await finalList.json() as unknown[]
      expect(items.length).toBe(15) // 5 initial + 10 new
    })
  })

  describe('DO request serialization (CF guarantee)', () => {
    it('should serialize requests to maintain consistency', async () => {
      const stub = getDoStub(testId)

      // Create entity
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Sequence', order: [] }])
      const entity = await createRes.json() as { $id: string }

      // Fire concurrent requests - Cloudflare guarantees serial execution
      const requests = Array.from({ length: 5 }, (_, i) =>
        rpcCall(stub, 'things.get', [entity.$id])
      )

      const responses = await Promise.all(requests)

      // All should return consistent state
      const results = await Promise.all(responses.map(r => r.json()))
      results.forEach(result => {
        expect((result as { $id: string }).$id).toBe(entity.$id)
      })
    })
  })
})

// ============================================================================
// Test: Concurrent RPC Calls
// ============================================================================

describe('Concurrent RPC Calls', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('Parallel RPC method invocations', () => {
    it('should handle parallel calls to different entity operations', async () => {
      const stub = getDoStub(testId)

      // Different entity types created concurrently
      const requests = [
        rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }]),
        rpcCall(stub, 'things.create', [{ $type: 'Order', total: 100 }]),
        rpcCall(stub, 'things.create', [{ $type: 'Product', price: 50 }]),
      ]

      const responses = await Promise.all(requests)
      const results = await Promise.all(responses.map(r => r.json()))

      expect((results[0] as { $type: string }).$type).toBe('Customer')
      expect((results[1] as { $type: string }).$type).toBe('Order')
      expect((results[2] as { $type: string }).$type).toBe('Product')
    })

    it('should maintain response ordering with Promise.all', async () => {
      const stub = getDoStub(testId)

      const expectedValues = [1, 2, 3, 4, 5]
      const requests = expectedValues.map(value =>
        rpcCall(stub, 'things.create', [{ $type: 'Numbered', value }])
      )

      const responses = await Promise.all(requests)
      const results = await Promise.all(responses.map(r => r.json()))

      // Promise.all maintains the order of the input array
      results.forEach((result, i) => {
        expect((result as { value: number }).value).toBe(expectedValues[i])
      })
    })

    it('should isolate errors between concurrent calls', async () => {
      const stub = getDoStub(testId)

      // Create one entity to update, then make invalid updates
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Test', name: 'valid' }])
      const created = await createRes.json() as { $id: string }

      const requests = [
        rpcCall(stub, 'things.get', [created.$id]), // Should succeed
        rpcCall(stub, 'things.get', ['non-existent-id']), // Should return null (not error)
        rpcCall(stub, 'things.get', [created.$id]), // Should succeed
      ]

      const responses = await Promise.all(requests)

      // First and third should return the entity
      const result0 = await responses[0].json() as { $id: string }
      const result2 = await responses[2].json() as { $id: string }
      expect(result0.$id).toBe(created.$id)
      expect(result2.$id).toBe(created.$id)

      // Second should return null (entity not found)
      const result1 = await responses[1].json()
      expect(result1).toBeNull()
    })

    it('should handle Promise.race for fastest response', async () => {
      const stub = getDoStub(testId)

      // Create two entities
      await rpcCall(stub, 'things.create', [{ $type: 'Fast', speed: 'fast' }])
      await rpcCall(stub, 'things.create', [{ $type: 'Slow', speed: 'slow' }])

      // Race to get either
      const fastRequest = rpcCall(stub, 'things.list', [{ $type: 'Fast' }])
      const slowRequest = rpcCall(stub, 'things.list', [{ $type: 'Slow' }])

      const winner = await Promise.race([fastRequest, slowRequest])
      expect(winner.status).toBe(200)
    })
  })

  describe('Error isolation between calls', () => {
    it('should not let one invalid call affect others', async () => {
      const stub = getDoStub(testId)

      // Mix of valid and invalid operations
      const requests = [
        rpcCall(stub, 'things.create', [{ $type: 'Valid1', name: 'test1' }]),
        rpcCall(stub, 'nonexistent.method', []), // Invalid method
        rpcCall(stub, 'things.create', [{ $type: 'Valid2', name: 'test2' }]),
      ]

      const responses = await Promise.all(requests)

      // First and third should succeed
      expect(responses[0].status).toBe(200)
      expect(responses[2].status).toBe(200)

      // Second should fail (404 for unknown method)
      expect(responses[1].status).toBe(404)

      // Valid entities should exist
      const list = await rpcCall(stub, 'things.list', [{}])
      const items = await list.json() as unknown[]
      expect(items.length).toBe(2)
    })
  })
})

// ============================================================================
// Test: Storage Race Conditions
// ============================================================================

describe('Storage Race Conditions', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('Concurrent writes to same key', () => {
    it('should handle concurrent creates without ID collision', async () => {
      const stub = getDoStub(testId)

      // Create 50 things concurrently
      const creates = Array.from({ length: 50 }, (_, i) =>
        rpcCall(stub, 'things.create', [{ $type: 'Concurrent', name: `item-${i}` }])
      )

      const responses = await Promise.all(creates)
      const results = await Promise.all(responses.map(r => r.json()))

      // All should succeed
      expect(results).toHaveLength(50)

      // All IDs should be unique
      const ids = results.map(r => (r as { $id: string }).$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(50)
    })

    it('should handle concurrent updates to same entity', async () => {
      const stub = getDoStub(testId)

      // Create an entity first
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'Counter', value: 0 }])
      const entity = await createRes.json() as { $id: string }

      // Attempt concurrent updates
      const updates = Array.from({ length: 10 }, (_, i) =>
        rpcCall(stub, 'things.update', [entity.$id, { value: i + 1 }])
      )

      const responses = await Promise.all(updates)

      // All updates should succeed
      responses.forEach(r => {
        expect(r.status).toBe(200)
      })

      // Final value should be valid (last write wins)
      const final = await rpcCall(stub, 'things.get', [entity.$id])
      const result = await final.json() as { value: number }
      expect(result.value).toBeGreaterThanOrEqual(1)
      expect(result.value).toBeLessThanOrEqual(10)
    })

    it('should handle concurrent deletes gracefully', async () => {
      const stub = getDoStub(testId)

      // Create entities
      const entities = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          rpcCall(stub, 'things.create', [{ $type: 'ToDelete', name: `item-${i}` }])
        )
      )
      const created = await Promise.all(entities.map(r => r.json() as Promise<{ $id: string }>))

      // Try to delete each entity twice concurrently
      const deletePromises = created.flatMap(entity => [
        rpcCall(stub, 'things.delete', [entity.$id]),
        rpcCall(stub, 'things.delete', [entity.$id]),
      ])

      const results = await Promise.all(deletePromises)

      // All delete calls should complete (first succeeds, second is no-op)
      results.forEach(r => {
        expect(r.status).toBe(200)
      })

      // All entities should be deleted
      const finalList = await rpcCall(stub, 'things.list', [{ $type: 'ToDelete' }])
      const remaining = await finalList.json() as unknown[]
      expect(remaining.length).toBe(0)
    })
  })

  describe('Read-modify-write patterns', () => {
    it('should demonstrate last-write-wins behavior', async () => {
      const stub = getDoStub(testId)

      // Create a counter
      const createRes = await rpcCall(stub, 'things.create', [{ $type: 'RMWCounter', value: 0 }])
      const counter = await createRes.json() as { $id: string }

      // Concurrent read-modify-write operations
      const operations = Array.from({ length: 10 }, async (_, i) => {
        // Read current value
        const getRes = await rpcCall(stub, 'things.get', [counter.$id])
        const current = await getRes.json() as { value: number }

        // Small delay to increase interleaving
        await delay(Math.random() * 5)

        // Update with incremented value
        await rpcCall(stub, 'things.update', [counter.$id, { value: current.value + 1 }])
      })

      await Promise.all(operations)

      // Final value may be less than 10 due to race conditions
      // This is expected behavior - demonstrates need for transactions
      const finalRes = await rpcCall(stub, 'things.get', [counter.$id])
      const final = await finalRes.json() as { value: number }
      expect(typeof final.value).toBe('number')
      expect(final.value).toBeGreaterThan(0)
    })
  })

  describe('Bulk operations', () => {
    it('should handle concurrent bulk creates', async () => {
      const stub = getDoStub(testId)

      // Create items in batches concurrently
      const batch1 = Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          rpcCall(stub, 'things.create', [{ $type: 'Batch1', value: i }])
        )
      )
      const batch2 = Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          rpcCall(stub, 'things.create', [{ $type: 'Batch2', value: i + 10 }])
        )
      )

      const [result1, result2] = await Promise.all([batch1, batch2])

      expect(result1).toHaveLength(10)
      expect(result2).toHaveLength(10)

      // All items should exist
      const batch1List = await rpcCall(stub, 'things.list', [{ $type: 'Batch1' }])
      const batch2List = await rpcCall(stub, 'things.list', [{ $type: 'Batch2' }])

      expect((await batch1List.json() as unknown[]).length).toBe(10)
      expect((await batch2List.json() as unknown[]).length).toBe(10)
    })
  })
})

// ============================================================================
// Test: Event Concurrency
// ============================================================================

describe('Event Concurrency', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  it('should handle concurrent event emissions', async () => {
    const stub = getDoStub(testId)

    // Emit 20 events concurrently
    const emits = Array.from({ length: 20 }, (_, i) =>
      rpcCall(stub, 'events.emit', [{ type: 'concurrent.event', payload: { index: i } }])
    )

    const responses = await Promise.all(emits)

    // All should succeed
    responses.forEach(r => {
      expect(r.status).toBe(200)
    })

    // All events should be stored
    const queryRes = await rpcCall(stub, 'events.query', [{ type: 'concurrent.event' }])
    const events = await queryRes.json() as unknown[]
    expect(events.length).toBe(20)
  })

  it('should maintain event ordering per type', async () => {
    const stub = getDoStub(testId)

    // Emit events sequentially to ensure order
    for (let i = 0; i < 10; i++) {
      await rpcCall(stub, 'events.emit', [{ type: 'ordered.event', payload: { seq: i } }])
    }

    // Query and verify order
    const queryRes = await rpcCall(stub, 'events.query', [{ type: 'ordered.event' }])
    const events = await queryRes.json() as Array<{ payload: { seq: number }; $timestamp: number }>

    // Events should be ordered by timestamp
    for (let i = 1; i < events.length; i++) {
      expect(events[i].$timestamp).toBeGreaterThanOrEqual(events[i - 1].$timestamp)
    }
  })
})

// ============================================================================
// Test: Relationship Concurrency
// ============================================================================

describe('Relationship Concurrency', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  it('should handle concurrent relationship additions', async () => {
    const stub = getDoStub(testId)

    // Add 20 relationships concurrently
    const adds = Array.from({ length: 20 }, (_, i) =>
      rpcCall(stub, 'relationships.add', [{ subject: `user-${i}`, predicate: 'follows', object: 'user-main' }])
    )

    const responses = await Promise.all(adds)

    // All should succeed
    responses.forEach(r => {
      expect(r.status).toBe(200)
    })

    // All relationships should be stored
    const findRes = await rpcCall(stub, 'relationships.find', [{ predicate: 'follows', object: 'user-main' }])
    const rels = await findRes.json() as unknown[]
    expect(rels.length).toBe(20)
  })

  it('should handle concurrent relationship removals', async () => {
    const stub = getDoStub(testId)

    // First add relationships
    const adds = Array.from({ length: 10 }, (_, i) =>
      rpcCall(stub, 'relationships.add', [{ subject: `user-${i}`, predicate: 'likes', object: 'post-1' }])
    )
    await Promise.all(adds)

    // Then remove them concurrently (some might be duplicate removals)
    const removes = Array.from({ length: 15 }, (_, i) =>
      rpcCall(stub, 'relationships.remove', [{ subject: `user-${i % 10}`, predicate: 'likes', object: 'post-1' }])
    )

    const responses = await Promise.all(removes)

    // All should complete without error
    responses.forEach(r => {
      expect(r.status).toBe(200)
    })

    // All relationships should be removed
    const findRes = await rpcCall(stub, 'relationships.find', [{ predicate: 'likes', object: 'post-1' }])
    const rels = await findRes.json() as unknown[]
    expect(rels.length).toBe(0)
  })
})

// ============================================================================
// Test: Combined Stress Tests
// ============================================================================

describe('Combined Stress Tests', () => {
  let testId: string

  beforeEach(() => {
    testId = generateTestId()
  })

  it('should handle high load with mixed operations', async () => {
    const stub = getDoStub(testId)

    // Generate mixed operations
    const operations: Promise<Response>[] = []

    // 30 creates
    for (let i = 0; i < 30; i++) {
      operations.push(rpcCall(stub, 'things.create', [{ $type: 'StressTest', index: i }]))
    }

    // 20 events
    for (let i = 0; i < 20; i++) {
      operations.push(rpcCall(stub, 'events.emit', [{ type: 'stress.test', payload: { index: i } }]))
    }

    // 10 relationships
    for (let i = 0; i < 10; i++) {
      operations.push(rpcCall(stub, 'relationships.add', [{ subject: `stress-${i}`, predicate: 'tests', object: `target-${i}` }]))
    }

    const responses = await Promise.all(operations)

    // All should succeed
    const successful = responses.filter(r => r.status === 200)
    expect(successful.length).toBe(60)
  })

  it('should maintain consistency under concurrent mixed load', async () => {
    const stub = getDoStub(testId)

    // Create initial data
    const initialCreates = Array.from({ length: 5 }, (_, i) =>
      rpcCall(stub, 'things.create', [{ $type: 'Mixed', value: i }])
    )
    const created = await Promise.all(initialCreates)
    const entities = await Promise.all(created.map(r => r.json() as Promise<{ $id: string }>))

    // Concurrent reads and updates
    const operations: Promise<Response>[] = []

    // Reads
    for (const entity of entities) {
      operations.push(rpcCall(stub, 'things.get', [entity.$id]))
    }

    // Updates
    for (const entity of entities) {
      operations.push(rpcCall(stub, 'things.update', [entity.$id, { updated: true }]))
    }

    // More reads
    for (const entity of entities) {
      operations.push(rpcCall(stub, 'things.get', [entity.$id]))
    }

    const responses = await Promise.all(operations)

    // All should succeed
    responses.forEach(r => {
      expect(r.status).toBe(200)
    })

    // Final state should be consistent
    const finalList = await rpcCall(stub, 'things.list', [{ $type: 'Mixed' }])
    const finalEntities = await finalList.json() as Array<{ updated?: boolean }>
    expect(finalEntities.length).toBe(5)

    // All should have been updated
    finalEntities.forEach(entity => {
      expect(entity.updated).toBe(true)
    })
  })

  it('should recover from partial failures in concurrent batch operations', async () => {
    const stub = getDoStub(testId)

    // Create some valid entities
    const validCreates = Array.from({ length: 20 }, (_, i) =>
      rpcCall(stub, 'things.create', [{ $type: 'BatchTest', index: i }])
    )

    // Also try some operations that might fail
    const invalidOps = Array.from({ length: 5 }, () =>
      rpcCall(stub, 'nonexistent.method', [])
    )

    const allOps = [...validCreates, ...invalidOps]
    const responses = await Promise.all(allOps)

    // Valid creates should succeed
    const successfulCreates = responses.slice(0, 20).filter(r => r.status === 200)
    expect(successfulCreates.length).toBe(20)

    // Invalid ops should fail
    const failedOps = responses.slice(20).filter(r => r.status !== 200)
    expect(failedOps.length).toBe(5)

    // All valid entities should exist
    const listRes = await rpcCall(stub, 'things.list', [{ $type: 'BatchTest' }])
    const entities = await listRes.json() as unknown[]
    expect(entities.length).toBe(20)
  })
})
