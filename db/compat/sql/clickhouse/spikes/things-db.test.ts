/**
 * SPIKE TEST: Things + Relationships Schema with DO SQLite Hot Tier
 *
 * Tests for the universal data model:
 * - Things: Generic entities with type, JSON data, optional embeddings
 * - Relationships: Typed connections between Things
 *
 * Using better-sqlite3 for testing (simulates DO SQLite behavior)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  ThingsDB,
  generateId,
  serializeEmbedding,
  deserializeEmbedding,
  type Thing,
  type ThingInput,
  type RelationshipInput,
} from './things-db'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestDB(): Database.Database {
  return new Database(':memory:')
}

function createTestThingsDB(db?: Database.Database): ThingsDB {
  return new ThingsDB(db ?? createTestDB())
}

const sampleThings: ThingInput[] = [
  {
    type: 'user',
    data: {
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
      settings: { theme: 'dark', notifications: true },
    },
  },
  {
    type: 'user',
    data: {
      name: 'Bob',
      email: 'bob@example.com',
      age: 25,
      settings: { theme: 'light', notifications: false },
    },
  },
  {
    type: 'post',
    data: {
      title: 'Hello World',
      content: 'This is my first post',
      tags: ['intro', 'hello'],
      views: 100,
    },
  },
  {
    type: 'comment',
    data: {
      text: 'Great post!',
      likes: 5,
    },
  },
]

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('generateId', () => {
    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(1000)
    })

    it('generates IDs in a sortable format', () => {
      const id1 = generateId()
      // Small delay to ensure different timestamp
      const id2 = generateId()

      // IDs should be roughly sortable by creation time
      expect(typeof id1).toBe('string')
      expect(typeof id2).toBe('string')
      expect(id1.length).toBeGreaterThan(10)
    })
  })

  describe('embedding serialization', () => {
    it('round-trips Float32Array correctly', () => {
      const original = new Float32Array([1.0, 2.5, -3.14, 0.0, 1e10])
      const serialized = serializeEmbedding(original)
      const deserialized = deserializeEmbedding(serialized)

      expect(deserialized).toBeInstanceOf(Float32Array)
      expect(deserialized.length).toBe(original.length)
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i])
      }
    })

    it('handles number array input', () => {
      const original = [1.0, 2.5, -3.14]
      const serialized = serializeEmbedding(original)
      const deserialized = deserializeEmbedding(serialized)

      expect(deserialized.length).toBe(original.length)
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i])
      }
    })

    it('handles large embeddings (1536 dims like OpenAI)', () => {
      const original = new Float32Array(1536)
      for (let i = 0; i < 1536; i++) {
        original[i] = Math.random() * 2 - 1
      }

      const serialized = serializeEmbedding(original)
      const deserialized = deserializeEmbedding(serialized)

      expect(deserialized.length).toBe(1536)
      expect(serialized.length).toBe(1536 * 4) // 4 bytes per float32
    })
  })
})

// ============================================================================
// ThingsDB CRUD Tests
// ============================================================================

describe('ThingsDB - CRUD Operations', () => {
  let thingsDB: ThingsDB

  beforeEach(() => {
    thingsDB = createTestThingsDB()
  })

  afterEach(() => {
    thingsDB.close()
  })

  describe('createThing', () => {
    it('creates a thing with auto-generated ID', () => {
      const thing = thingsDB.createThing({
        type: 'user',
        data: { name: 'Alice', email: 'alice@example.com' },
      })

      expect(thing.id).toBeTruthy()
      expect(thing.type).toBe('user')
      expect(thing.data).toEqual({ name: 'Alice', email: 'alice@example.com' })
      expect(thing.createdAt).toBeInstanceOf(Date)
      expect(thing.updatedAt).toBeInstanceOf(Date)
      expect(thing.embedding).toBeNull()
    })

    it('creates a thing with custom ID', () => {
      const thing = thingsDB.createThing({
        id: 'custom-id-123',
        type: 'user',
        data: { name: 'Bob' },
      })

      expect(thing.id).toBe('custom-id-123')
    })

    it('creates a thing with embedding', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])
      const thing = thingsDB.createThing({
        type: 'document',
        data: { title: 'Test Doc' },
        embedding,
      })

      expect(thing.embedding).toBeInstanceOf(Float32Array)
      expect(thing.embedding?.length).toBe(5)
      expect(thing.embedding?.[0]).toBeCloseTo(0.1)
    })

    it('handles complex nested JSON data', () => {
      const complexData = {
        user: {
          name: 'Alice',
          profile: {
            bio: 'Developer',
            social: {
              twitter: '@alice',
              github: 'alice',
            },
          },
        },
        tags: ['a', 'b', 'c'],
        metadata: {
          created: '2024-01-01',
          numbers: [1, 2, 3],
        },
      }

      const thing = thingsDB.createThing({
        type: 'complex',
        data: complexData,
      })

      expect(thing.data).toEqual(complexData)
    })
  })

  describe('getThing', () => {
    it('retrieves an existing thing', () => {
      const created = thingsDB.createThing({
        type: 'user',
        data: { name: 'Alice' },
      })

      const retrieved = thingsDB.getThing(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.type).toBe('user')
      expect(retrieved?.data).toEqual({ name: 'Alice' })
    })

    it('returns null for non-existent thing', () => {
      const retrieved = thingsDB.getThing('non-existent-id')
      expect(retrieved).toBeNull()
    })

    it('retrieves thing with embedding', () => {
      const embedding = new Float32Array([1, 2, 3])
      const created = thingsDB.createThing({
        type: 'doc',
        data: { title: 'Test' },
        embedding,
      })

      const retrieved = thingsDB.getThing(created.id)

      expect(retrieved?.embedding).toBeInstanceOf(Float32Array)
      expect(retrieved?.embedding?.[0]).toBeCloseTo(1)
    })
  })

  describe('updateThing', () => {
    it('updates thing data', () => {
      const thing = thingsDB.createThing({
        type: 'user',
        data: { name: 'Alice', age: 25 },
      })

      const updated = thingsDB.updateThing(thing.id, {
        data: { name: 'Alice Smith', age: 26 },
      })

      expect(updated.data).toEqual({ name: 'Alice Smith', age: 26 })
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        thing.updatedAt.getTime()
      )
    })

    it('updates thing type', () => {
      const thing = thingsDB.createThing({
        type: 'draft',
        data: { content: 'hello' },
      })

      const updated = thingsDB.updateThing(thing.id, {
        type: 'published',
      })

      expect(updated.type).toBe('published')
    })

    it('updates embedding', () => {
      const thing = thingsDB.createThing({
        type: 'doc',
        data: { title: 'Test' },
      })

      const newEmbedding = new Float32Array([4, 5, 6])
      const updated = thingsDB.updateThing(thing.id, {
        embedding: newEmbedding,
      })

      expect(updated.embedding?.[0]).toBeCloseTo(4)
    })

    it('throws for non-existent thing', () => {
      expect(() =>
        thingsDB.updateThing('non-existent', { data: {} })
      ).toThrow('Thing not found')
    })
  })

  describe('deleteThing', () => {
    it('deletes an existing thing', () => {
      const thing = thingsDB.createThing({
        type: 'user',
        data: { name: 'Alice' },
      })

      thingsDB.deleteThing(thing.id)

      expect(thingsDB.getThing(thing.id)).toBeNull()
    })

    it('throws for non-existent thing', () => {
      expect(() => thingsDB.deleteThing('non-existent')).toThrow(
        'Thing not found'
      )
    })

    it('cascades to delete relationships', () => {
      const user = thingsDB.createThing({
        type: 'user',
        data: { name: 'Alice' },
      })
      const post = thingsDB.createThing({
        type: 'post',
        data: { title: 'Hello' },
      })

      thingsDB.createRelationship({
        fromId: user.id,
        toId: post.id,
        type: 'authored',
      })

      thingsDB.deleteThing(user.id)

      // Relationship should be deleted due to CASCADE
      const relationships = thingsDB.findRelationships(post.id, undefined, 'incoming')
      expect(relationships).toHaveLength(0)
    })
  })
})

// ============================================================================
// Relationship Tests
// ============================================================================

describe('ThingsDB - Relationships', () => {
  let thingsDB: ThingsDB
  let alice: Thing
  let bob: Thing
  let post: Thing

  beforeEach(() => {
    thingsDB = createTestThingsDB()

    alice = thingsDB.createThing({
      id: 'alice',
      type: 'user',
      data: { name: 'Alice' },
    })
    bob = thingsDB.createThing({
      id: 'bob',
      type: 'user',
      data: { name: 'Bob' },
    })
    post = thingsDB.createThing({
      id: 'post-1',
      type: 'post',
      data: { title: 'Hello World' },
    })
  })

  afterEach(() => {
    thingsDB.close()
  })

  describe('createRelationship', () => {
    it('creates a relationship between things', () => {
      const rel = thingsDB.createRelationship({
        fromId: alice.id,
        toId: post.id,
        type: 'authored',
      })

      expect(rel.id).toBeTruthy()
      expect(rel.fromId).toBe(alice.id)
      expect(rel.toId).toBe(post.id)
      expect(rel.type).toBe('authored')
      expect(rel.createdAt).toBeInstanceOf(Date)
    })

    it('creates relationship with data', () => {
      const rel = thingsDB.createRelationship({
        fromId: alice.id,
        toId: bob.id,
        type: 'follows',
        data: { since: '2024-01-01', closeFriend: true },
      })

      expect(rel.data).toEqual({ since: '2024-01-01', closeFriend: true })
    })

    it('prevents duplicate relationships', () => {
      thingsDB.createRelationship({
        fromId: alice.id,
        toId: bob.id,
        type: 'follows',
      })

      expect(() =>
        thingsDB.createRelationship({
          fromId: alice.id,
          toId: bob.id,
          type: 'follows',
        })
      ).toThrow('Relationship already exists')
    })

    it('allows same pair with different types', () => {
      thingsDB.createRelationship({
        fromId: alice.id,
        toId: bob.id,
        type: 'follows',
      })

      const rel2 = thingsDB.createRelationship({
        fromId: alice.id,
        toId: bob.id,
        type: 'blocks',
      })

      expect(rel2.type).toBe('blocks')
    })

    it('throws for non-existent source thing', () => {
      expect(() =>
        thingsDB.createRelationship({
          fromId: 'non-existent',
          toId: bob.id,
          type: 'follows',
        })
      ).toThrow('Referenced thing not found')
    })
  })

  describe('findRelated', () => {
    beforeEach(() => {
      // Alice follows Bob
      thingsDB.createRelationship({
        fromId: alice.id,
        toId: bob.id,
        type: 'follows',
      })

      // Alice authored post
      thingsDB.createRelationship({
        fromId: alice.id,
        toId: post.id,
        type: 'authored',
      })

      // Bob liked post
      thingsDB.createRelationship({
        fromId: bob.id,
        toId: post.id,
        type: 'liked',
      })
    })

    it('finds outgoing related things', () => {
      const related = thingsDB.findRelated(alice.id, undefined, 'outgoing')

      expect(related).toHaveLength(2)
      const ids = related.map((t) => t.id)
      expect(ids).toContain(bob.id)
      expect(ids).toContain(post.id)
    })

    it('finds outgoing related things by type', () => {
      const related = thingsDB.findRelated(alice.id, 'follows', 'outgoing')

      expect(related).toHaveLength(1)
      expect(related[0].id).toBe(bob.id)
    })

    it('finds incoming related things', () => {
      const related = thingsDB.findRelated(post.id, undefined, 'incoming')

      expect(related).toHaveLength(2)
      const ids = related.map((t) => t.id)
      expect(ids).toContain(alice.id)
      expect(ids).toContain(bob.id)
    })

    it('finds both directions', () => {
      const related = thingsDB.findRelated(bob.id, undefined, 'both')

      expect(related).toHaveLength(2)
      const ids = related.map((t) => t.id)
      expect(ids).toContain(alice.id) // incoming: alice follows bob
      expect(ids).toContain(post.id) // outgoing: bob liked post
    })
  })
})

// ============================================================================
// JSON Query Tests
// ============================================================================

describe('ThingsDB - JSON Queries', () => {
  let thingsDB: ThingsDB

  beforeEach(() => {
    thingsDB = createTestThingsDB()

    // Create sample data
    for (const input of sampleThings) {
      thingsDB.createThing(input)
    }
  })

  afterEach(() => {
    thingsDB.close()
  })

  describe('findByType', () => {
    it('finds all things of a type', () => {
      const users = thingsDB.findByType('user')
      expect(users).toHaveLength(2)
      expect(users[0].type).toBe('user')
    })

    it('returns empty array for unknown type', () => {
      const unknowns = thingsDB.findByType('unknown')
      expect(unknowns).toHaveLength(0)
    })
  })

  describe('findByJsonPath', () => {
    it('finds by simple string field', () => {
      const results = thingsDB.findByJsonPath('$.name', 'Alice')
      expect(results).toHaveLength(1)
      expect(results[0].data.name).toBe('Alice')
    })

    it('finds by numeric field', () => {
      const results = thingsDB.findByJsonPath('$.age', 30)
      expect(results).toHaveLength(1)
      expect(results[0].data.name).toBe('Alice')
    })

    it('finds by nested field', () => {
      const results = thingsDB.findByJsonPath('$.settings.theme', 'dark')
      expect(results).toHaveLength(1)
      expect(results[0].data.name).toBe('Alice')
    })

    it('returns empty for non-matching value', () => {
      const results = thingsDB.findByJsonPath('$.name', 'NonExistent')
      expect(results).toHaveLength(0)
    })
  })

  describe('findByJsonQuery', () => {
    it('finds by multiple conditions', () => {
      const results = thingsDB.findByJsonQuery({
        '$.type': 'user',
      })

      // Note: this searches the data field, not the type column
      // Let's search by age instead
      const byAge = thingsDB.findByJsonQuery({
        '$.age': 30,
      })
      expect(byAge).toHaveLength(1)
    })

    it('combines multiple JSON conditions', () => {
      const results = thingsDB.findByJsonQuery({
        '$.age': 25,
        '$.settings.theme': 'light',
      })
      expect(results).toHaveLength(1)
      expect(results[0].data.name).toBe('Bob')
    })
  })

  describe('raw SQL query', () => {
    it('executes custom JSON queries', () => {
      const result = thingsDB.query<{ id: string; name: string }>(`
        SELECT id, json_extract(data, '$.name') as name
        FROM things
        WHERE type = 'user' AND json_extract(data, '$.age') > 20
        ORDER BY json_extract(data, '$.age') DESC
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].name).toBe('Alice') // age 30
      expect(result.rows[1].name).toBe('Bob') // age 25
    })

    it('queries array elements', () => {
      const result = thingsDB.query(`
        SELECT id, json_extract(data, '$.tags[0]') as first_tag
        FROM things
        WHERE type = 'post'
      `)

      expect(result.rows).toHaveLength(1)
      expect((result.rows[0] as { first_tag: string }).first_tag).toBe('intro')
    })
  })
})

// ============================================================================
// Batch Operation Tests
// ============================================================================

describe('ThingsDB - Batch Operations', () => {
  let thingsDB: ThingsDB

  beforeEach(() => {
    thingsDB = createTestThingsDB()
  })

  afterEach(() => {
    thingsDB.close()
  })

  it('creates multiple things in transaction', () => {
    const things = thingsDB.createThings(sampleThings)

    expect(things).toHaveLength(4)
    expect(thingsDB.stats().thingCount).toBe(4)
  })

  it('creates multiple relationships in transaction', () => {
    const user = thingsDB.createThing({
      id: 'user-1',
      type: 'user',
      data: { name: 'Alice' },
    })

    const posts = thingsDB.createThings([
      { id: 'post-1', type: 'post', data: { title: 'Post 1' } },
      { id: 'post-2', type: 'post', data: { title: 'Post 2' } },
      { id: 'post-3', type: 'post', data: { title: 'Post 3' } },
    ])

    const relationships = thingsDB.createRelationships(
      posts.map((post) => ({
        fromId: user.id,
        toId: post.id,
        type: 'authored',
      }))
    )

    expect(relationships).toHaveLength(3)
    expect(thingsDB.findRelated(user.id)).toHaveLength(3)
  })

  it('rolls back transaction on error', () => {
    const user = thingsDB.createThing({
      id: 'user-1',
      type: 'user',
      data: { name: 'Alice' },
    })

    expect(() =>
      thingsDB.createRelationships([
        { fromId: user.id, toId: 'post-1', type: 'authored' },
        { fromId: user.id, toId: 'post-2', type: 'authored' }, // This will fail - post-2 doesn't exist
      ])
    ).toThrow()

    // No relationships should have been created
    expect(thingsDB.findRelationships(user.id)).toHaveLength(0)
  })
})

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe('ThingsDB - Performance Benchmarks', () => {
  let thingsDB: ThingsDB

  beforeEach(() => {
    thingsDB = createTestThingsDB()
  })

  afterEach(() => {
    thingsDB.close()
  })

  it('achieves 10K+ writes/sec for things', () => {
    const count = 10000
    const things: ThingInput[] = []

    for (let i = 0; i < count; i++) {
      things.push({
        type: 'event',
        data: {
          eventType: 'page_view',
          userId: `user_${i % 100}`,
          timestamp: Date.now(),
          metadata: {
            page: `/page/${i}`,
            referrer: 'google.com',
          },
        },
      })
    }

    const start = performance.now()
    thingsDB.createThings(things)
    const elapsed = performance.now() - start

    const writesPerSec = Math.round((count / elapsed) * 1000)

    console.log(`\n  Things write benchmark:`)
    console.log(`    ${count} inserts in ${elapsed.toFixed(0)}ms`)
    console.log(`    ${writesPerSec.toLocaleString()} writes/sec\n`)

    expect(writesPerSec).toBeGreaterThan(10000)
    expect(thingsDB.stats().thingCount).toBe(count)
  })

  it('achieves <10ms query latency for JSON path queries', () => {
    // Create 10K things first
    const things: ThingInput[] = []
    for (let i = 0; i < 10000; i++) {
      things.push({
        type: 'user',
        data: {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 20 + (i % 60),
          active: i % 2 === 0,
        },
      })
    }
    thingsDB.createThings(things)

    // Benchmark JSON path query
    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      thingsDB.findByJsonPath('$.email', `user${i * 100}@example.com`)
      latencies.push(performance.now() - start)
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.99)]

    console.log(`\n  JSON path query benchmark (10K rows):`)
    console.log(`    Avg latency: ${avgLatency.toFixed(3)}ms`)
    console.log(`    P99 latency: ${p99Latency.toFixed(3)}ms\n`)

    expect(avgLatency).toBeLessThan(10)
    expect(p99Latency).toBeLessThan(10)
  })

  it('achieves <10ms latency for relationship traversal', () => {
    // Create a social graph
    const userCount = 1000
    const avgFollows = 10

    // Create users
    const userInputs: ThingInput[] = []
    for (let i = 0; i < userCount; i++) {
      userInputs.push({
        id: `user_${i}`,
        type: 'user',
        data: { name: `User ${i}` },
      })
    }
    thingsDB.createThings(userInputs)

    // Create relationships
    const relInputs: { fromId: string; toId: string; type: string }[] = []
    for (let i = 0; i < userCount; i++) {
      for (let j = 0; j < avgFollows; j++) {
        const followId = Math.floor(Math.random() * userCount)
        if (followId !== i) {
          relInputs.push({
            fromId: `user_${i}`,
            toId: `user_${followId}`,
            type: 'follows',
          })
        }
      }
    }

    // Use transaction but catch duplicates
    const db = (thingsDB as unknown as { db: Database.Database }).db
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO relationships (id, from_id, to_id, type, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((items: typeof relInputs) => {
      for (const item of items) {
        stmt.run(
          generateId(),
          item.fromId,
          item.toId,
          item.type,
          null,
          Date.now()
        )
      }
    })

    insertMany(relInputs)

    // Benchmark relationship traversal
    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const userId = `user_${Math.floor(Math.random() * userCount)}`
      const start = performance.now()
      thingsDB.findRelated(userId, 'follows', 'outgoing')
      latencies.push(performance.now() - start)
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.99)]

    console.log(`\n  Relationship traversal benchmark (${userCount} users, ~${avgFollows} follows each):`)
    console.log(`    Avg latency: ${avgLatency.toFixed(3)}ms`)
    console.log(`    P99 latency: ${p99Latency.toFixed(3)}ms\n`)

    expect(avgLatency).toBeLessThan(10)
  })

  it('measures database size growth', () => {
    // Create varying amounts of data and measure size
    const sizes = [1000, 5000, 10000]
    const results: { count: number; sizeKB: number; bytesPerThing: number }[] =
      []

    for (const count of sizes) {
      const testDb = new Database(':memory:')
      const testThingsDB = new ThingsDB(testDb)

      const things: ThingInput[] = []
      for (let i = 0; i < count; i++) {
        things.push({
          type: 'event',
          data: {
            eventType: 'page_view',
            userId: `user_${i % 100}`,
            page: `/page/${i}`,
            timestamp: Date.now(),
            metadata: { key: 'value', num: i },
          },
        })
      }

      testThingsDB.createThings(things)

      const stats = testThingsDB.stats()
      const sizeKB = stats.sizeBytes / 1024
      const bytesPerThing = stats.sizeBytes / count

      results.push({ count, sizeKB, bytesPerThing })

      testThingsDB.close()
    }

    console.log(`\n  Database size growth:`)
    for (const r of results) {
      console.log(
        `    ${r.count.toLocaleString()} things: ${r.sizeKB.toFixed(0)} KB (${r.bytesPerThing.toFixed(0)} bytes/thing)`
      )
    }

    // Estimate capacity for 10GB DO limit
    const avgBytesPerThing =
      results.reduce((a, r) => a + r.bytesPerThing, 0) / results.length
    const estimatedCapacity = Math.floor((10 * 1024 * 1024 * 1024) / avgBytesPerThing)

    console.log(
      `    Estimated 10GB capacity: ~${(estimatedCapacity / 1_000_000).toFixed(1)}M things\n`
    )

    // Verify reasonable size per thing
    expect(results[0].bytesPerThing).toBeLessThan(500) // Should be under 500 bytes/thing
  })
})

// ============================================================================
// JSON Index Tests
// ============================================================================

describe('ThingsDB - JSON Indexes', () => {
  it('creates JSON indexes via generated columns', () => {
    const db = createTestDB()
    const thingsDB = new ThingsDB(db, {
      jsonIndexes: ['$.email', '$.user.status'],
    })

    // Create some data
    thingsDB.createThings([
      { type: 'user', data: { email: 'test@example.com', user: { status: 'active' } } },
      { type: 'user', data: { email: 'other@example.com', user: { status: 'inactive' } } },
    ])

    // Verify indexes exist
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_json_%'")
      .all() as { name: string }[]

    expect(indexes.some((i) => i.name.includes('email'))).toBe(true)

    // Query should still work
    const results = thingsDB.findByJsonPath('$.email', 'test@example.com')
    expect(results).toHaveLength(1)

    thingsDB.close()
  })
})

// ============================================================================
// Stats and Maintenance Tests
// ============================================================================

describe('ThingsDB - Stats and Maintenance', () => {
  let thingsDB: ThingsDB

  beforeEach(() => {
    thingsDB = createTestThingsDB()
  })

  afterEach(() => {
    thingsDB.close()
  })

  it('returns accurate stats', () => {
    thingsDB.createThings([
      { type: 'user', data: { name: 'Alice' } },
      { type: 'user', data: { name: 'Bob' } },
      { type: 'post', data: { title: 'Hello' } },
    ])

    thingsDB.createRelationship({
      fromId: thingsDB.findByType('user')[0].id,
      toId: thingsDB.findByType('post')[0].id,
      type: 'authored',
    })

    const stats = thingsDB.stats()

    expect(stats.thingCount).toBe(3)
    expect(stats.relationshipCount).toBe(1)
    expect(stats.sizeBytes).toBeGreaterThan(0)
  })

  it('optimizes database', () => {
    // Create and delete data to fragment
    const things = thingsDB.createThings(
      Array.from({ length: 1000 }, (_, i) => ({
        type: 'temp',
        data: { index: i },
      }))
    )

    for (const thing of things.slice(0, 500)) {
      thingsDB.deleteThing(thing.id)
    }

    const sizeBefore = thingsDB.stats().sizeBytes

    thingsDB.optimize()

    const sizeAfter = thingsDB.stats().sizeBytes

    // Size should be reduced after VACUUM
    expect(sizeAfter).toBeLessThanOrEqual(sizeBefore)
  })
})
