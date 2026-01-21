/**
 * Entity and Relationship Benchmarks
 *
 * Measures the performance of entity and relationship operations including:
 * - Entity (Thing) creation, retrieval, update, delete
 * - Relationship creation, query, traversal
 * - Bulk operations for both entities and relationships
 *
 * Uses in-memory stores for consistent, fast benchmarking.
 * For SQLite benchmarks, see the real miniflare tests.
 *
 * @module tests/benchmarks/entity-relationship.bench
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { runBenchmark, runBenchmarkBatch, formatMetrics } from './runner'
import type { BenchmarkMetrics } from './types'
import {
  createThingsStore,
  createRelationshipsStore,
  type ThingsStore,
  type RelationshipsStore,
  type Thing,
  type Relationship,
} from '../../db'

describe('Entity (Thing) Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}
  let things: ThingsStore

  beforeEach(() => {
    things = createThingsStore()
  })

  it('should benchmark single entity creation', async () => {
    let i = 0
    const metrics = await runBenchmark(
      'entity-create-single',
      async () => {
        await things.create({
          $type: 'Customer',
          name: `Customer ${i++}`,
          email: `customer${i}@example.com`,
          status: 'active',
        })
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['entity-create-single'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    // In-memory operations may be sub-millisecond (0ms in low-precision timers)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
    // Entity creation should be fast - under 5ms typically for in-memory
    expect(metrics.mean).toBeLessThan(5)
  })

  it('should benchmark single entity retrieval', async () => {
    // Pre-populate with entities
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const thing = await things.create({
        $type: 'Customer',
        name: `Customer ${i}`,
        email: `customer${i}@example.com`,
      })
      ids.push(thing.$id)
    }

    let i = 0
    const metrics = await runBenchmark(
      'entity-get-single',
      async () => {
        await things.get(ids[i++ % 100])
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['entity-get-single'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark entity getMany (batch retrieval)', async () => {
    // Pre-populate with entities
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const thing = await things.create({
        $type: 'Customer',
        name: `Customer ${i}`,
        email: `customer${i}@example.com`,
      })
      ids.push(thing.$id)
    }

    const metrics = await runBenchmark(
      'entity-get-many-10',
      async () => {
        // Get 10 random entities
        const batchIds = ids.slice(0, 10)
        await things.getMany(batchIds)
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['entity-get-many-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark single entity update', async () => {
    // Pre-populate with entities
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const thing = await things.create({
        $type: 'Customer',
        name: `Customer ${i}`,
        email: `customer${i}@example.com`,
        status: 'active',
      })
      ids.push(thing.$id)
    }

    let i = 0
    const metrics = await runBenchmark(
      'entity-update-single',
      async () => {
        const id = ids[i++ % 100]
        await things.update(id, { status: 'updated', lastModified: Date.now() })
      },
      { iterations: 200, warmupIterations: 20 }
    )

    benchmarkResults['entity-update-single'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(200)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark entity list with type filter', async () => {
    // Pre-populate with mixed types
    for (let i = 0; i < 50; i++) {
      await things.create({ $type: 'Customer', name: `Customer ${i}` })
      await things.create({ $type: 'Order', orderId: `order-${i}` })
      await things.create({ $type: 'Product', productId: `product-${i}` })
    }

    const metrics = await runBenchmark(
      'entity-list-by-type',
      async () => {
        await things.list({ type: 'Customer', limit: 50 })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['entity-list-by-type'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark entity list with cursor pagination', async () => {
    // Pre-populate with entities
    for (let i = 0; i < 200; i++) {
      await things.create({ $type: 'Customer', name: `Customer ${i}` })
    }

    let cursor: string | undefined
    const metrics = await runBenchmark(
      'entity-list-cursor-pagination',
      async () => {
        const result = await things.listWithCursor({ type: 'Customer', limit: 20, cursor })
        cursor = result.cursor ?? undefined
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['entity-list-cursor-pagination'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark bulk entity creation (10 items)', async () => {
    let batch = 0
    const metrics = await runBenchmark(
      'entity-bulk-create-10',
      async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
          $type: 'Customer',
          name: `Batch${batch}-Customer${i}`,
          email: `batch${batch}-customer${i}@example.com`,
        }))
        await things.bulkCreate(items)
        batch++
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['entity-bulk-create-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark bulk entity creation (100 items)', async () => {
    let batch = 0
    const metrics = await runBenchmark(
      'entity-bulk-create-100',
      async () => {
        const items = Array.from({ length: 100 }, (_, i) => ({
          $type: 'Customer',
          name: `Batch${batch}-Customer${i}`,
          email: `batch${batch}-customer${i}@example.com`,
        }))
        await things.bulkCreate(items)
        batch++
      },
      { iterations: 20, warmupIterations: 2 }
    )

    benchmarkResults['entity-bulk-create-100'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(20)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark bulk entity update (10 items)', async () => {
    // Pre-populate with entities
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const thing = await things.create({
        $type: 'Customer',
        name: `Customer ${i}`,
        status: 'active',
      })
      ids.push(thing.$id)
    }

    let offset = 0
    const metrics = await runBenchmark(
      'entity-bulk-update-10',
      async () => {
        const items = ids.slice(offset % 90, (offset % 90) + 10).map(id => ({
          id,
          data: { status: 'bulk-updated', batchNumber: offset },
        }))
        await things.bulkUpdate(items)
        offset += 10
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['entity-bulk-update-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark bulk entity deletion (10 items)', async () => {
    const metrics = await runBenchmarkBatch(
      'entity-bulk-delete-10',
      // Setup: create 10 entities
      async () => {
        for (let i = 0; i < 10; i++) {
          await things.create({
            $type: 'ToDelete',
            name: `Delete ${i}`,
          })
        }
      },
      // Operation: delete all ToDelete entities
      async () => {
        const toDelete = await things.list({ type: 'ToDelete' })
        if (toDelete.length > 0) {
          await things.bulkDelete(toDelete.map(t => t.$id))
        }
      },
      undefined,
      { iterations: 30, warmupIterations: 3 }
    )

    benchmarkResults['entity-bulk-delete-10'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(30)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  // Export results for baseline comparison
  afterAll(() => {
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})

describe('Relationship Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}
  let relationships: RelationshipsStore
  let things: ThingsStore

  beforeEach(() => {
    relationships = createRelationshipsStore()
    things = createThingsStore()
  })

  it('should benchmark single relationship creation', async () => {
    // Pre-create many entities for unique relationships
    const users: string[] = []
    const orders: string[] = []
    // Create enough entities for warmup + iterations (10 warmup + 100 iterations = 110)
    for (let i = 0; i < 150; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}` })
      const order = await things.create({ $type: 'Order', orderId: `order-${i}` })
      users.push(user.$id)
      orders.push(order.$id)
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-create-single',
      async () => {
        // Each iteration creates a unique relationship
        await relationships.add({
          subject: users[i],
          predicate: 'placed',
          object: orders[i],
        })
        i++
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-create-single'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark relationship query by subject', async () => {
    // Create a graph of relationships
    const users: string[] = []
    const orders: string[] = []
    for (let i = 0; i < 20; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}` })
      users.push(user.$id)
      // Each user has 5 orders
      for (let j = 0; j < 5; j++) {
        const order = await things.create({ $type: 'Order', orderId: `order-${i}-${j}` })
        orders.push(order.$id)
        await relationships.add({
          subject: user.$id,
          predicate: 'placed',
          object: order.$id,
        })
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-query-by-subject',
      async () => {
        await relationships.find({ subject: users[i++ % 20]! })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-query-by-subject'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark relationship query by predicate', async () => {
    // Create relationships with different predicates
    const entities: string[] = []
    for (let i = 0; i < 50; i++) {
      const entity = await things.create({ $type: 'Entity', name: `Entity ${i}` })
      entities.push(entity.$id)
    }

    // Create relationships with various predicates
    const predicates = ['follows', 'owns', 'created', 'likes', 'manages']
    for (let i = 0; i < entities.length - 1; i++) {
      await relationships.add({
        subject: entities[i],
        predicate: predicates[i % predicates.length],
        object: entities[i + 1],
      })
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-query-by-predicate',
      async () => {
        await relationships.find({ predicate: predicates[i++ % predicates.length]! })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-query-by-predicate'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark relationship query by object (reverse lookup)', async () => {
    // Create a many-to-one relationship pattern (many users follow one influencer)
    const followers: string[] = []
    const influencers: string[] = []

    for (let i = 0; i < 10; i++) {
      const influencer = await things.create({ $type: 'User', name: `Influencer ${i}` })
      influencers.push(influencer.$id)
    }

    for (let i = 0; i < 100; i++) {
      const follower = await things.create({ $type: 'User', name: `Follower ${i}` })
      followers.push(follower.$id)
      // Each follower follows a random influencer
      await relationships.add({
        subject: follower.$id,
        predicate: 'follows',
        object: influencers[i % 10],
      })
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-query-by-object',
      async () => {
        await relationships.find({ object: influencers[i++ % 10]! })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-query-by-object'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark getRelated (forward traversal)', async () => {
    // Create a social graph
    const users: string[] = []
    for (let i = 0; i < 50; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}` })
      users.push(user.$id)
    }

    // Each user follows 5 other users
    for (let i = 0; i < users.length; i++) {
      for (let j = 1; j <= 5; j++) {
        const targetIdx = (i + j) % users.length
        try {
          await relationships.add({
            subject: users[i],
            predicate: 'follows',
            object: users[targetIdx],
          })
        } catch {
          // Skip duplicates
        }
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-getRelated',
      async () => {
        await relationships.getRelated(users[i++ % 50], 'follows')
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-getRelated'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark getRelatedTo (reverse traversal)', async () => {
    // Create a social graph (same as above)
    const users: string[] = []
    for (let i = 0; i < 50; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}` })
      users.push(user.$id)
    }

    for (let i = 0; i < users.length; i++) {
      for (let j = 1; j <= 5; j++) {
        const targetIdx = (i + j) % users.length
        try {
          await relationships.add({
            subject: users[i],
            predicate: 'follows',
            object: users[targetIdx],
          })
        } catch {
          // Skip duplicates
        }
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-getRelatedTo',
      async () => {
        await relationships.getRelatedTo(users[i++ % 50], 'follows')
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-getRelatedTo'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark relationship query with cursor pagination', async () => {
    // Create many relationships
    const entities: string[] = []
    for (let i = 0; i < 100; i++) {
      const entity = await things.create({ $type: 'Entity', name: `Entity ${i}` })
      entities.push(entity.$id)
    }

    for (let i = 0; i < entities.length - 1; i++) {
      await relationships.add({
        subject: entities[i],
        predicate: 'linkedTo',
        object: entities[i + 1],
      })
    }

    let cursor: string | undefined
    const metrics = await runBenchmark(
      'relationship-query-cursor-pagination',
      async () => {
        const result = await relationships.findWithCursor({
          predicate: 'linkedTo',
          limit: 20,
          cursor,
        })
        cursor = result.cursor ?? undefined
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['relationship-query-cursor-pagination'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark complex relationship query (multi-filter)', async () => {
    // Create a graph with specific patterns
    const users: string[] = []
    const items: string[] = []

    for (let i = 0; i < 30; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}` })
      users.push(user.$id)
    }

    for (let i = 0; i < 50; i++) {
      const item = await things.create({ $type: 'Item', name: `Item ${i}` })
      items.push(item.$id)
    }

    // Create owns relationships
    for (let i = 0; i < users.length; i++) {
      for (let j = 0; j < 3; j++) {
        const itemIdx = (i * 3 + j) % items.length
        await relationships.add({
          subject: users[i],
          predicate: 'owns',
          object: items[itemIdx],
        })
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'relationship-query-multi-filter',
      async () => {
        // Query with both subject and predicate
        await relationships.find({
          subject: users[i++ % 30]!,
          predicate: 'owns',
        })
      },
      { iterations: 100, warmupIterations: 10 }
    )

    benchmarkResults['relationship-query-multi-filter'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(100)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark relationship removal', async () => {
    const metrics = await runBenchmarkBatch(
      'relationship-remove',
      // Setup: create a relationship
      async () => {
        const user = await things.create({ $type: 'User', name: 'TempUser' })
        const item = await things.create({ $type: 'Item', name: 'TempItem' })
        await relationships.add({
          subject: user.$id,
          predicate: 'tempRel',
          object: item.$id,
        })
      },
      // Operation: remove the relationship
      async () => {
        const rels = await relationships.find({ predicate: 'tempRel' })
        if (rels.length > 0) {
          const rel = rels[0]
          await relationships.remove({
            subject: rel.subject,
            predicate: rel.predicate,
            object: rel.object,
          })
        }
      },
      undefined,
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['relationship-remove'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  // Export results for baseline comparison
  afterAll(() => {
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})

describe('Combined Entity + Relationship Benchmarks', () => {
  const benchmarkResults: Record<string, BenchmarkMetrics> = {}
  let things: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(() => {
    things = createThingsStore()
    relationships = createRelationshipsStore()
  })

  it('should benchmark creating entity with relationships', async () => {
    // Pre-create some target entities
    const targets: string[] = []
    for (let i = 0; i < 20; i++) {
      const target = await things.create({ $type: 'Target', name: `Target ${i}` })
      targets.push(target.$id)
    }

    let i = 0
    const metrics = await runBenchmark(
      'entity-with-relationships-create',
      async () => {
        // Create entity
        const entity = await things.create({
          $type: 'Source',
          name: `Source ${i}`,
        })

        // Create 3 relationships to existing targets
        for (let j = 0; j < 3; j++) {
          await relationships.add({
            subject: entity.$id,
            predicate: 'relatesTo',
            object: targets[(i * 3 + j) % 20],
          })
        }
        i++
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['entity-with-relationships-create'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark fetching entity with related entities', async () => {
    // Create a graph
    const users: string[] = []
    for (let i = 0; i < 20; i++) {
      const user = await things.create({ $type: 'User', name: `User ${i}`, bio: `Bio for user ${i}` })
      users.push(user.$id)
    }

    // Create orders for each user
    for (const userId of users) {
      for (let j = 0; j < 5; j++) {
        const order = await things.create({
          $type: 'Order',
          orderId: `order-${userId}-${j}`,
          total: Math.random() * 100,
        })
        await relationships.add({
          subject: userId,
          predicate: 'placed',
          object: order.$id,
        })
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'entity-fetch-with-related',
      async () => {
        const userId = users[i++ % 20]
        // Get user
        const user = await things.get(userId)
        // Get related orders
        const orderIds = await relationships.getRelated(userId, 'placed')
        // Fetch all orders
        await things.getMany(orderIds)
      },
      { iterations: 50, warmupIterations: 5 }
    )

    benchmarkResults['entity-fetch-with-related'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(50)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  it('should benchmark graph traversal (2 hops)', async () => {
    // Create a 3-level hierarchy: Organization -> Team -> User
    const orgs: string[] = []
    const teams: string[] = []
    const users: string[] = []

    // Create organizations
    for (let i = 0; i < 5; i++) {
      const org = await things.create({ $type: 'Organization', name: `Org ${i}` })
      orgs.push(org.$id)

      // Create teams for each org
      for (let j = 0; j < 4; j++) {
        const team = await things.create({ $type: 'Team', name: `Team ${i}-${j}` })
        teams.push(team.$id)
        await relationships.add({
          subject: org.$id,
          predicate: 'hasTeam',
          object: team.$id,
        })

        // Create users for each team
        for (let k = 0; k < 3; k++) {
          const user = await things.create({ $type: 'User', name: `User ${i}-${j}-${k}` })
          users.push(user.$id)
          await relationships.add({
            subject: team.$id,
            predicate: 'hasMember',
            object: user.$id,
          })
        }
      }
    }

    let i = 0
    const metrics = await runBenchmark(
      'graph-traversal-2-hops',
      async () => {
        const orgId = orgs[i++ % 5]
        // Get all teams in org
        const teamIds = await relationships.getRelated(orgId, 'hasTeam')
        // Get all users in all teams
        const allUserIds: string[] = []
        for (const teamId of teamIds) {
          const userIds = await relationships.getRelated(teamId, 'hasMember')
          allUserIds.push(...userIds)
        }
        // Optionally fetch all users
        await things.getMany(allUserIds)
      },
      { iterations: 30, warmupIterations: 3 }
    )

    benchmarkResults['graph-traversal-2-hops'] = metrics

    console.log('\n' + formatMetrics(metrics))

    expect(metrics.iterations).toBe(30)
    expect(metrics.mean).toBeGreaterThanOrEqual(0)
  })

  // Export results for baseline comparison
  afterAll(() => {
    ;(globalThis as any).__benchmarkResults = {
      ...((globalThis as any).__benchmarkResults || {}),
      ...benchmarkResults,
    }
  })
})
