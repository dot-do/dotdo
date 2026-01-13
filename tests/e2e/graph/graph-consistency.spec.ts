/**
 * E2E Tests: Graph Consistency Under Concurrent Access
 *
 * Tests that graph operations maintain consistency when
 * multiple clients access and modify the graph concurrently.
 *
 * These tests are particularly important for Durable Objects
 * where:
 * - Each DO processes requests sequentially (single-threaded)
 * - Cross-DO operations may experience eventual consistency
 * - Writes should be immediately visible in the same DO
 * - Concurrent writers to the same entity need conflict handling
 *
 * @module tests/e2e/graph/graph-consistency.spec
 */

import { test, expect } from '@playwright/test'

const GRAPH_API = '/api/graph'

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Graph Consistency - Read After Write', () => {
  test('immediately reads back created Thing', async ({ request }) => {
    const thingId = uniqueId('raw')

    // Write
    const writeResponse = await request.post(`${GRAPH_API}/things`, {
      data: {
        id: thingId,
        type: 'RAWTest',
        data: { value: 42, timestamp: Date.now() },
      },
    })
    expect(writeResponse.status()).toBe(201)

    // Immediate read
    const readResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    expect(readResponse.ok()).toBe(true)

    const thing = await readResponse.json()
    expect(thing.id).toBe(thingId)
    expect(thing.data.value).toBe(42)
  })

  test('immediately reads back created Relationship', async ({ request }) => {
    const sourceId = uniqueId('raw-source')
    const targetId = uniqueId('raw-target')

    // Create Things
    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'Source', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: targetId, type: 'Target', data: {} },
    })

    // Write relationship
    const relResponse = await request.post(`${GRAPH_API}/relationships`, {
      data: {
        from: sourceId,
        to: targetId,
        verb: 'links',
        data: { strength: 0.8 },
      },
    })
    expect(relResponse.status()).toBe(201)
    const rel = await relResponse.json()

    // Immediate read
    const readResponse = await request.get(`${GRAPH_API}/relationships/${rel.id}`)
    expect(readResponse.ok()).toBe(true)

    const readRel = await readResponse.json()
    expect(readRel.from).toBe(sourceId)
    expect(readRel.to).toBe(targetId)
    expect(readRel.data.strength).toBe(0.8)
  })

  test('reads updated value immediately after update', async ({ request }) => {
    const thingId = uniqueId('update-raw')

    // Create
    await request.post(`${GRAPH_API}/things`, {
      data: { id: thingId, type: 'UpdateTest', data: { version: 1 } },
    })

    // Update
    await request.patch(`${GRAPH_API}/things/${thingId}`, {
      data: { data: { version: 2, updated: true } },
    })

    // Immediate read should see version 2
    const readResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    const thing = await readResponse.json()

    expect(thing.data.version).toBe(2)
    expect(thing.data.updated).toBe(true)
  })

  test('relationship query returns newly created relationship', async ({ request }) => {
    const sourceId = uniqueId('query-source')
    const targetId = uniqueId('query-target')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'QuerySource', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: targetId, type: 'QueryTarget', data: {} },
    })

    // Create relationship
    await request.post(`${GRAPH_API}/relationships`, {
      data: { from: sourceId, to: targetId, verb: 'points' },
    })

    // Query should immediately return the new relationship
    const queryResponse = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=points`)
    expect(queryResponse.ok()).toBe(true)

    const result = await queryResponse.json()
    expect(result.items.length).toBe(1)
    expect(result.items[0].to).toBe(targetId)
  })
})

test.describe('Graph Consistency - Concurrent Writes', () => {
  test('handles concurrent updates to same Thing', async ({ request }) => {
    const thingId = uniqueId('concurrent-update')

    // Create base Thing
    await request.post(`${GRAPH_API}/things`, {
      data: {
        id: thingId,
        type: 'ConcurrentTest',
        data: { counter: 0 },
      },
    })

    // Fire multiple concurrent updates
    const updates = Array.from({ length: 5 }, (_, i) =>
      request.patch(`${GRAPH_API}/things/${thingId}`, {
        data: { data: { [`update_${i}`]: i, lastWriter: i } },
      })
    )

    const responses = await Promise.all(updates)

    // All updates should succeed (DO serializes them)
    for (const response of responses) {
      expect(response.ok()).toBe(true)
    }

    // Final state should have all updates
    const finalResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    const final = await finalResponse.json()

    // All update fields should be present
    for (let i = 0; i < 5; i++) {
      expect(final.data[`update_${i}`]).toBe(i)
    }
  })

  test('handles concurrent relationship creation', async ({ request }) => {
    const sourceId = uniqueId('concurrent-rel-source')
    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'ConcurrentSource', data: {} },
    })

    // Create multiple targets
    const targetIds = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const targetId = `${sourceId}-target-${i}`
        await request.post(`${GRAPH_API}/things`, {
          data: { id: targetId, type: 'ConcurrentTarget', data: {} },
        })
        return targetId
      })
    )

    // Concurrently create relationships to all targets
    const relCreations = targetIds.map((targetId, i) =>
      request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'concurrentLink',
          data: { index: i },
        },
      })
    )

    const responses = await Promise.all(relCreations)

    // All should succeed
    for (const response of responses) {
      expect(response.status()).toBe(201)
    }

    // Verify all relationships exist
    const queryResponse = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=concurrentLink`)
    const result = await queryResponse.json()

    expect(result.items.length).toBe(5)
  })

  test('maintains consistency under interleaved read-write', async ({ request }) => {
    const thingId = uniqueId('interleaved')

    // Create initial
    await request.post(`${GRAPH_API}/things`, {
      data: { id: thingId, type: 'InterleavedTest', data: { values: [] } },
    })

    // Interleaved reads and writes
    const operations = []
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        // Write
        operations.push(
          request.patch(`${GRAPH_API}/things/${thingId}`, {
            data: { data: { [`key_${i}`]: i } },
          })
        )
      } else {
        // Read
        operations.push(request.get(`${GRAPH_API}/things/${thingId}`))
      }
    }

    const responses = await Promise.all(operations)

    // All operations should succeed
    for (const response of responses) {
      expect(response.ok()).toBe(true)
    }

    // Final state should have all written keys
    const finalResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    const final = await finalResponse.json()

    for (let i = 0; i < 10; i += 2) {
      expect(final.data[`key_${i}`]).toBe(i)
    }
  })
})

test.describe('Graph Consistency - Delete Operations', () => {
  test('delete is immediately reflected', async ({ request }) => {
    const thingId = uniqueId('delete-consistency')

    // Create
    await request.post(`${GRAPH_API}/things`, {
      data: { id: thingId, type: 'DeleteTest', data: {} },
    })

    // Verify exists
    const existsResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    expect(existsResponse.ok()).toBe(true)

    // Delete
    const deleteResponse = await request.delete(`${GRAPH_API}/things/${thingId}`)
    expect(deleteResponse.status()).toBe(204)

    // Immediately should be 404
    const goneResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    expect(goneResponse.status()).toBe(404)
  })

  test('relationship query excludes deleted relationships', async ({ request }) => {
    const sourceId = uniqueId('del-rel-source')
    const targetId = uniqueId('del-rel-target')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'Source', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: targetId, type: 'Target', data: {} },
    })

    // Create relationship
    const relResponse = await request.post(`${GRAPH_API}/relationships`, {
      data: { from: sourceId, to: targetId, verb: 'deletable' },
    })
    const rel = await relResponse.json()

    // Query shows it
    const beforeQuery = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=deletable`)
    const before = await beforeQuery.json()
    expect(before.items.length).toBe(1)

    // Delete relationship
    await request.delete(`${GRAPH_API}/relationships/${rel.id}`)

    // Query immediately excludes it
    const afterQuery = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=deletable`)
    const after = await afterQuery.json()
    expect(after.items.length).toBe(0)
  })

  test('cascaded deletes are consistent', async ({ request }) => {
    const parentId = uniqueId('cascade-parent')
    const childId = uniqueId('cascade-child')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: parentId, type: 'Parent', data: {} },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: childId, type: 'Child', data: {} },
    })

    const relResponse = await request.post(`${GRAPH_API}/relationships`, {
      data: { from: parentId, to: childId, verb: 'hasChild' },
    })
    const rel = await relResponse.json()

    // Delete parent (should cascade delete relationship)
    await request.delete(`${GRAPH_API}/things/${parentId}`)

    // Relationship should be gone
    const relCheck = await request.get(`${GRAPH_API}/relationships/${rel.id}`)
    expect(relCheck.status()).toBe(404)

    // Query from deleted source should return empty
    const queryResponse = await request.get(`${GRAPH_API}/relationships?from=${parentId}`)
    const result = await queryResponse.json()
    expect(result.items.length).toBe(0)
  })
})

test.describe('Graph Consistency - Ordering', () => {
  test('updates applied in order', async ({ request }) => {
    const thingId = uniqueId('order-test')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: thingId, type: 'OrderTest', data: { sequence: [] } },
    })

    // Sequential updates with sequence numbers
    for (let i = 0; i < 5; i++) {
      await request.patch(`${GRAPH_API}/things/${thingId}`, {
        data: { data: { [`step_${i}`]: i, lastStep: i } },
      })
    }

    // Final state should reflect last update
    const finalResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
    const final = await finalResponse.json()

    expect(final.data.lastStep).toBe(4)
    for (let i = 0; i < 5; i++) {
      expect(final.data[`step_${i}`]).toBe(i)
    }
  })

  test('relationships maintain creation order in queries', async ({ request }) => {
    const sourceId = uniqueId('order-source')
    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'OrderSource', data: {} },
    })

    // Create relationships in specific order
    const order = ['first', 'second', 'third', 'fourth']
    for (const name of order) {
      const targetId = `${sourceId}-${name}`
      await request.post(`${GRAPH_API}/things`, {
        data: { id: targetId, type: 'OrderTarget', data: { name } },
      })
      await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'ordered',
          data: { name },
        },
      })
    }

    // Query should return in consistent order
    const response = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=ordered&orderBy=createdAt`)
    const result = await response.json()

    expect(result.items.length).toBe(4)
    // When ordered by createdAt, should be in creation order
    for (let i = 0; i < order.length; i++) {
      expect(result.items[i].data.name).toBe(order[i])
    }
  })
})

test.describe('Graph Consistency - Edge Cases', () => {
  test('handles empty graph queries gracefully', async ({ request }) => {
    const emptyType = `Empty-${Date.now()}`

    const response = await request.get(`${GRAPH_API}/things?type=${emptyType}`)
    expect(response.ok()).toBe(true)

    const result = await response.json()
    expect(result.items).toEqual([])
    expect(result.count).toBe(0)
  })

  test('handles non-existent traversal start node', async ({ request }) => {
    const nonExistent = `non-existent-${Date.now()}`

    const response = await request.get(`${GRAPH_API}/traverse?start=${nonExistent}&direction=outgoing&maxDepth=2`)

    expect(response.status()).toBe(404)
  })

  test('handles self-referential relationships consistently', async ({ request }) => {
    const selfId = uniqueId('self-ref')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: selfId, type: 'SelfRef', data: { name: 'Ouroboros' } },
    })

    // Create self-referential relationship
    await request.post(`${GRAPH_API}/relationships`, {
      data: { from: selfId, to: selfId, verb: 'references' },
    })

    // Query outgoing should return self
    const outgoing = await request.get(`${GRAPH_API}/relationships?from=${selfId}&verb=references`)
    const outResult = await outgoing.json()
    expect(outResult.items.length).toBe(1)
    expect(outResult.items[0].to).toBe(selfId)

    // Query incoming should also return self
    const incoming = await request.get(`${GRAPH_API}/relationships?to=${selfId}&verb=references`)
    const inResult = await incoming.json()
    expect(inResult.items.length).toBe(1)
    expect(inResult.items[0].from).toBe(selfId)
  })

  test('handles very long relationship chains', async ({ request }) => {
    const prefix = uniqueId('chain')
    const chainLength = 10

    // Create chain: node0 -> node1 -> node2 -> ... -> node9
    for (let i = 0; i < chainLength; i++) {
      await request.post(`${GRAPH_API}/things`, {
        data: { id: `${prefix}-node-${i}`, type: 'ChainNode', data: { index: i } },
      })
    }

    for (let i = 0; i < chainLength - 1; i++) {
      await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: `${prefix}-node-${i}`,
          to: `${prefix}-node-${i + 1}`,
          verb: 'next',
        },
      })
    }

    // Traverse full chain
    const response = await request.get(
      `${GRAPH_API}/traverse?start=${prefix}-node-0&direction=outgoing&maxDepth=${chainLength}`
    )
    expect(response.ok()).toBe(true)

    const result = await response.json()
    expect(result.nodes.length).toBe(chainLength - 1) // Excludes start node
  })

  test('handles concurrent delete and read', async ({ request }) => {
    const thingId = uniqueId('race-delete')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: thingId, type: 'RaceTest', data: {} },
    })

    // Fire concurrent delete and read
    const [deleteResponse, readResponse] = await Promise.all([
      request.delete(`${GRAPH_API}/things/${thingId}`),
      request.get(`${GRAPH_API}/things/${thingId}`),
    ])

    // Delete should succeed
    expect(deleteResponse.status()).toBe(204)

    // Read might succeed (200) or fail (404) depending on timing
    // Either is acceptable - we just shouldn't get an error
    expect([200, 404]).toContain(readResponse.status())
  })
})

test.describe('Graph Consistency - Transaction Semantics', () => {
  test('batch creates are atomic within DO', async ({ request }) => {
    const prefix = uniqueId('batch')

    // Batch create
    const response = await request.post(`${GRAPH_API}/things/batch`, {
      data: {
        items: [
          { id: `${prefix}-a`, type: 'BatchTest', data: { name: 'A' } },
          { id: `${prefix}-b`, type: 'BatchTest', data: { name: 'B' } },
          { id: `${prefix}-c`, type: 'BatchTest', data: { name: 'C' } },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.created).toBe(3)

    // All should exist
    for (const suffix of ['a', 'b', 'c']) {
      const getResponse = await request.get(`${GRAPH_API}/things/${prefix}-${suffix}`)
      expect(getResponse.ok()).toBe(true)
    }
  })

  test('batch update maintains consistency', async ({ request }) => {
    const prefix = uniqueId('batch-update')

    // Create items
    for (const suffix of ['x', 'y', 'z']) {
      await request.post(`${GRAPH_API}/things`, {
        data: { id: `${prefix}-${suffix}`, type: 'BatchUpdateTest', data: { status: 'initial' } },
      })
    }

    // Batch update
    const response = await request.patch(`${GRAPH_API}/things/batch`, {
      data: {
        updates: [
          { id: `${prefix}-x`, data: { status: 'updated' } },
          { id: `${prefix}-y`, data: { status: 'updated' } },
          { id: `${prefix}-z`, data: { status: 'updated' } },
        ],
      },
    })

    expect(response.ok()).toBe(true)

    // All should be updated
    for (const suffix of ['x', 'y', 'z']) {
      const getResponse = await request.get(`${GRAPH_API}/things/${prefix}-${suffix}`)
      const thing = await getResponse.json()
      expect(thing.data.status).toBe('updated')
    }
  })
})
