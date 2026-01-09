/**
 * EdgePostgres Sharding Tests
 *
 * RED TDD Phase: These tests define the expected behavior for ShardedPostgres -
 * distributing data across multiple Durable Objects using consistent hashing.
 *
 * All tests are expected to FAIL initially since no implementation exists.
 *
 * ShardedPostgres provides:
 * - Consistent hash-based shard routing for up to 1000 shards (10TB total)
 * - Automatic shard key extraction from queries
 * - Cross-shard query fan-out and result merging
 * - Single-shard transactions (multi-shard not supported)
 * - Rebalancing with minimal data movement using virtual nodes
 *
 * Architecture (from README.md):
 * - Each shard is a separate Durable Object running EdgePostgres
 * - ShardRouter uses consistent hashing with 150 virtual nodes per shard
 * - Cross-shard queries fan out to all relevant shards and merge results
 * - Rebalancing only moves data between old and new shard boundaries
 *
 * @see README.md for architecture details
 * @see edge-postgres.ts for EdgePostgres implementation
 * @see dotdo-b9zv0 for issue details
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent module so tests fail
import {
  ShardedPostgres,
  ShardRouter,
  type ShardConfig,
  type ShardInfo,
  type ShardQueryResult,
  type RebalanceResult,
} from './sharding'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Mock Durable Object context for testing
 */
interface MockDurableObjectState {
  storage: {
    get: <T>(key: string) => Promise<T | undefined>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
  id: {
    toString: () => string
    name?: string
  }
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Mock Durable Object stub for testing cross-DO calls
 */
interface MockDurableObjectStub {
  fetch: (request: Request) => Promise<Response>
}

/**
 * Mock Durable Object namespace for testing
 */
interface MockDurableObjectNamespace {
  get: (id: { toString(): string }) => MockDurableObjectStub
  idFromName: (name: string) => { toString(): string }
  newUniqueId: () => { toString(): string }
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  FSX?: unknown
  R2_BUCKET?: unknown
  EDGE_POSTGRES_SHARDS: MockDurableObjectNamespace
}

/**
 * Create mock DO context for testing
 */
function createMockContext(): MockDurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    id: {
      toString: () => 'test-do-id-12345',
      name: 'test-do',
    },
    waitUntil: (promise: Promise<unknown>) => { promise.catch(() => {}) },
  }
}

/**
 * Create mock DO namespace for testing shard communication
 */
function createMockDONamespace(): MockDurableObjectNamespace {
  const shardStores = new Map<string, Map<string, unknown>>()
  const shardResponses = new Map<string, (sql: string, params: unknown[]) => unknown>()

  return {
    get: (id: { toString(): string }): MockDurableObjectStub => {
      const shardId = id.toString()
      if (!shardStores.has(shardId)) {
        shardStores.set(shardId, new Map())
      }
      return {
        fetch: async (request: Request) => {
          const body = await request.json() as { sql: string; params: unknown[] }
          const handler = shardResponses.get(shardId)
          if (handler) {
            return new Response(JSON.stringify(handler(body.sql, body.params)))
          }
          return new Response(JSON.stringify({ rows: [] }))
        },
      }
    },
    idFromName: (name: string) => ({
      toString: () => `shard-${name}`,
    }),
    newUniqueId: () => ({
      toString: () => `shard-${Math.random().toString(36).slice(2)}`,
    }),
  }
}

/**
 * Create mock environment
 */
function createMockEnv(): MockEnv {
  return {
    FSX: {},
    R2_BUCKET: {},
    EDGE_POSTGRES_SHARDS: createMockDONamespace(),
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ShardedPostgres', () => {
  let ctx: MockDurableObjectState
  let env: MockEnv
  let db: ShardedPostgres

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockContext()
    env = createMockEnv()
  })

  afterEach(async () => {
    if (db) {
      await db.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // CONSTRUCTOR AND INITIALIZATION
  // ==========================================================================

  describe('Constructor', () => {
    it('should create ShardedPostgres instance with ctx, env, and config', () => {
      const config: ShardConfig = {
        sharding: {
          key: 'tenant_id',
          count: 100,
          algorithm: 'consistent',
        },
      }

      db = new ShardedPostgres(ctx, env, config)

      expect(db).toBeDefined()
      expect(db).toBeInstanceOf(ShardedPostgres)
    })

    it('should accept shard key configuration', () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'user_id',
          count: 50,
          algorithm: 'consistent',
        },
      })

      expect(db).toBeDefined()
    })

    it('should accept different sharding algorithms', () => {
      const algorithms: Array<'consistent' | 'range' | 'hash'> = ['consistent', 'range', 'hash']

      for (const algorithm of algorithms) {
        const instance = new ShardedPostgres(ctx, env, {
          sharding: {
            key: 'id',
            count: 10,
            algorithm,
          },
        })
        expect(instance).toBeDefined()
      }
    })

    it('should support up to 1000 shards', () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'id',
          count: 1000,
          algorithm: 'consistent',
        },
      })

      expect(db).toBeDefined()
    })

    it('should throw on invalid shard count (> 1000)', () => {
      expect(() => {
        new ShardedPostgres(ctx, env, {
          sharding: {
            key: 'id',
            count: 1001,
            algorithm: 'consistent',
          },
        })
      }).toThrow(/shard count|maximum|1000/i)
    })

    it('should throw on invalid shard count (< 1)', () => {
      expect(() => {
        new ShardedPostgres(ctx, env, {
          sharding: {
            key: 'id',
            count: 0,
            algorithm: 'consistent',
          },
        })
      }).toThrow(/shard count|minimum|positive/i)
    })

    it('should require shard key configuration', () => {
      expect(() => {
        new ShardedPostgres(ctx, env, {
          sharding: {
            key: '',
            count: 10,
            algorithm: 'consistent',
          },
        })
      }).toThrow(/shard key|required/i)
    })

    it('should accept custom DO namespace binding name', () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
          namespaceBinding: 'CUSTOM_SHARDS',
        },
      })

      expect(db).toBeDefined()
    })
  })

  // ==========================================================================
  // SHARD KEY EXTRACTION
  // ==========================================================================

  describe('Shard Key Extraction', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 100,
          algorithm: 'consistent',
        },
      })
    })

    it('should extract shard key from INSERT query parameters', async () => {
      const shardInfo = await db.getShardForQuery(
        'INSERT INTO orders (tenant_id, amount) VALUES ($1, $2)',
        ['tenant-123', 99.99]
      )

      expect(shardInfo).toBeDefined()
      expect(shardInfo.key).toBe('tenant-123')
      expect(shardInfo.shardId).toBeDefined()
    })

    it('should extract shard key from WHERE clause', async () => {
      const shardInfo = await db.getShardForQuery(
        'SELECT * FROM orders WHERE tenant_id = $1',
        ['tenant-456']
      )

      expect(shardInfo.key).toBe('tenant-456')
    })

    it('should extract shard key from UPDATE query', async () => {
      const shardInfo = await db.getShardForQuery(
        'UPDATE orders SET amount = $2 WHERE tenant_id = $1',
        ['tenant-789', 50.00]
      )

      expect(shardInfo.key).toBe('tenant-789')
    })

    it('should extract shard key from DELETE query', async () => {
      const shardInfo = await db.getShardForQuery(
        'DELETE FROM orders WHERE tenant_id = $1',
        ['tenant-abc']
      )

      expect(shardInfo.key).toBe('tenant-abc')
    })

    it('should handle compound shard keys', async () => {
      const compoundDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: ['region', 'tenant_id'],
          count: 100,
          algorithm: 'consistent',
        },
      })

      const shardInfo = await compoundDb.getShardForQuery(
        'SELECT * FROM orders WHERE region = $1 AND tenant_id = $2',
        ['us-west', 'tenant-123']
      )

      expect(shardInfo.key).toBe('us-west:tenant-123')

      await compoundDb.close()
    })

    it('should return null shard for cross-shard queries (no shard key)', async () => {
      const shardInfo = await db.getShardForQuery(
        'SELECT * FROM orders WHERE amount > $1',
        [100]
      )

      expect(shardInfo.key).toBeNull()
      expect(shardInfo.requiresFanOut).toBe(true)
    })

    it('should handle IN clause with multiple shard keys', async () => {
      const shardInfo = await db.getShardForQuery(
        'SELECT * FROM orders WHERE tenant_id IN ($1, $2, $3)',
        ['tenant-1', 'tenant-2', 'tenant-3']
      )

      expect(shardInfo.keys).toEqual(['tenant-1', 'tenant-2', 'tenant-3'])
      expect(shardInfo.shardIds.length).toBeGreaterThanOrEqual(1)
    })

    it('should extract shard key from nested subquery', async () => {
      const shardInfo = await db.getShardForQuery(
        'SELECT * FROM orders WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = $1)',
        ['user-123']
      )

      // Complex subquery should trigger fan-out
      expect(shardInfo.requiresFanOut).toBe(true)
    })

    it('should handle NULL shard key value', async () => {
      await expect(
        db.query('INSERT INTO orders (tenant_id, amount) VALUES ($1, $2)', [null, 99.99])
      ).rejects.toThrow(/shard key|null|required/i)
    })
  })

  // ==========================================================================
  // CONSISTENT HASH ROUTING
  // ==========================================================================

  describe('Consistent Hash Routing', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 100,
          algorithm: 'consistent',
        },
      })
    })

    it('should route same key to same shard consistently', async () => {
      const key = 'tenant-stable-123'

      const shard1 = await db.getShardForKey(key)
      const shard2 = await db.getShardForKey(key)
      const shard3 = await db.getShardForKey(key)

      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
    })

    it('should distribute keys evenly across shards', async () => {
      const shardCounts = new Map<number, number>()

      // Generate 10000 random keys
      for (let i = 0; i < 10000; i++) {
        const key = `tenant-${Math.random().toString(36).slice(2)}`
        const shardId = await db.getShardForKey(key)
        shardCounts.set(shardId, (shardCounts.get(shardId) || 0) + 1)
      }

      // Each shard should get approximately 100 keys (10000/100 shards)
      // Allow 50% variance for statistical distribution
      const expectedPerShard = 100
      const minExpected = expectedPerShard * 0.5
      const maxExpected = expectedPerShard * 1.5

      let withinRange = 0
      for (const count of shardCounts.values()) {
        if (count >= minExpected && count <= maxExpected) {
          withinRange++
        }
      }

      // At least 80% of shards should be within expected range
      expect(withinRange / shardCounts.size).toBeGreaterThan(0.8)
    })

    it('should use 150 virtual nodes per shard', async () => {
      const router = new ShardRouter({
        count: 10,
        algorithm: 'consistent',
        virtualNodesPerShard: 150,
      })

      // 10 shards * 150 virtual nodes = 1500 ring positions
      expect(router.getRingSize()).toBe(1500)
    })

    it('should maintain key stability after adding shards', async () => {
      // Record key->shard mappings with 100 shards
      const originalMappings = new Map<string, number>()
      const testKeys = Array.from({ length: 1000 }, (_, i) => `tenant-${i}`)

      for (const key of testKeys) {
        originalMappings.set(key, await db.getShardForKey(key))
      }

      // Simulate adding shards (new config with 110 shards)
      const expandedDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 110,
          algorithm: 'consistent',
        },
      })

      // Count how many keys moved
      let movedKeys = 0
      for (const key of testKeys) {
        const newShard = await expandedDb.getShardForKey(key)
        if (originalMappings.get(key) !== newShard) {
          movedKeys++
        }
      }

      // With consistent hashing, only ~10% of keys should move (10 new shards / 110 total)
      // Allow 5% variance
      expect(movedKeys / testKeys.length).toBeLessThan(0.15)

      await expandedDb.close()
    })

    it('should handle hash collisions gracefully', async () => {
      // Create keys that might hash similarly
      const similarKeys = [
        'tenant-aaa',
        'tenant-aab',
        'tenant-aac',
        'tenant-baa',
      ]

      const shards = new Set<number>()
      for (const key of similarKeys) {
        shards.add(await db.getShardForKey(key))
      }

      // Keys should still be distributed (not all on same shard)
      // With 100 shards, 4 keys should likely hit different shards
      expect(shards.size).toBeGreaterThan(1)
    })

    it('should support different hash algorithms', async () => {
      const xxhashDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'id',
          count: 10,
          algorithm: 'consistent',
          hashFunction: 'xxhash',
        },
      })

      const murmurDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'id',
          count: 10,
          algorithm: 'consistent',
          hashFunction: 'murmur3',
        },
      })

      // Same key may hash to different shards with different algorithms
      const shard1 = await xxhashDb.getShardForKey('test-key')
      const shard2 = await murmurDb.getShardForKey('test-key')

      // Both should be valid shard IDs
      expect(shard1).toBeGreaterThanOrEqual(0)
      expect(shard1).toBeLessThan(10)
      expect(shard2).toBeGreaterThanOrEqual(0)
      expect(shard2).toBeLessThan(10)

      await xxhashDb.close()
      await murmurDb.close()
    })
  })

  // ==========================================================================
  // SINGLE-SHARD QUERIES
  // ==========================================================================

  describe('Single-Shard Queries', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 100,
          algorithm: 'consistent',
        },
      })
    })

    it('should route INSERT to correct shard', async () => {
      const result = await db.query(
        'INSERT INTO orders (tenant_id, amount) VALUES ($1, $2) RETURNING *',
        ['tenant-123', 99.99]
      )

      expect(result).toBeDefined()
      expect(result.shardId).toBeDefined()
      expect(result.shardId).toBe(await db.getShardForKey('tenant-123'))
    })

    it('should route SELECT with shard key to single shard', async () => {
      // First insert
      await db.query(
        'INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)',
        ['tenant-456', 'order-1', 50.00]
      )

      const result = await db.query(
        'SELECT * FROM orders WHERE tenant_id = $1',
        ['tenant-456']
      )

      expect(result.rows).toBeDefined()
      expect(result.shardId).toBe(await db.getShardForKey('tenant-456'))
      expect(result.shardsQueried).toBe(1)
    })

    it('should route UPDATE to correct shard', async () => {
      await db.query(
        'INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)',
        ['tenant-789', 'order-1', 100.00]
      )

      const result = await db.query(
        'UPDATE orders SET amount = $2 WHERE tenant_id = $1 RETURNING *',
        ['tenant-789', 200.00]
      )

      expect(result.shardId).toBe(await db.getShardForKey('tenant-789'))
    })

    it('should route DELETE to correct shard', async () => {
      await db.query(
        'INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)',
        ['tenant-del', 'order-1', 100.00]
      )

      const result = await db.query(
        'DELETE FROM orders WHERE tenant_id = $1',
        ['tenant-del']
      )

      expect(result.shardId).toBe(await db.getShardForKey('tenant-del'))
    })

    it('should execute query only on target shard', async () => {
      const queriedShards: number[] = []

      // Mock to track which shards are queried
      const trackedDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 100,
          algorithm: 'consistent',
        },
        onShardQuery: (shardId) => {
          queriedShards.push(shardId)
        },
      })

      await trackedDb.query(
        'SELECT * FROM orders WHERE tenant_id = $1',
        ['tenant-single']
      )

      expect(queriedShards.length).toBe(1)

      await trackedDb.close()
    })

    it('should include shard metadata in result', async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1',
        ['tenant-meta']
      )

      expect(result.shardId).toBeDefined()
      expect(result.shardsQueried).toBe(1)
      expect(result.executionTimeMs).toBeDefined()
    })
  })

  // ==========================================================================
  // CROSS-SHARD QUERIES (FAN-OUT)
  // ==========================================================================

  describe('Cross-Shard Queries (Fan-Out)', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10, // Smaller shard count for testing
          algorithm: 'consistent',
        },
      })
    })

    it('should fan out queries without shard key to all shards', async () => {
      // Query without shard key
      const result = await db.query('SELECT * FROM orders WHERE amount > $1', [100])

      expect(result.shardsQueried).toBe(10)
      expect(result.isFanOut).toBe(true)
    })

    it('should merge results from all shards', async () => {
      // Insert data across multiple tenants (different shards)
      for (let i = 0; i < 5; i++) {
        await db.query(
          'INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)',
          [`tenant-${i}`, `order-${i}`, (i + 1) * 10]
        )
      }

      // Query across all shards
      const result = await db.query('SELECT COUNT(*) as count FROM orders', [])

      expect(result.rows[0].count).toBe(5)
    })

    it('should correctly aggregate across shards', async () => {
      // Insert data
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t1', 'o1', 100])
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t2', 'o2', 200])
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t3', 'o3', 300])

      const result = await db.query('SELECT SUM(amount) as total FROM orders', [])

      expect(result.rows[0].total).toBe(600)
    })

    it('should handle ORDER BY across shards', async () => {
      // Insert data across shards
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t1', 'o1', 30])
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t2', 'o2', 10])
      await db.query('INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)', ['t3', 'o3', 20])

      const result = await db.query(
        'SELECT * FROM orders ORDER BY amount ASC',
        []
      )

      expect(result.rows[0].amount).toBe(10)
      expect(result.rows[1].amount).toBe(20)
      expect(result.rows[2].amount).toBe(30)
    })

    it('should handle LIMIT across shards', async () => {
      // Insert 20 orders across shards
      for (let i = 0; i < 20; i++) {
        await db.query(
          'INSERT INTO orders (tenant_id, order_id, amount) VALUES ($1, $2, $3)',
          [`tenant-${i % 10}`, `order-${i}`, i]
        )
      }

      const result = await db.query(
        'SELECT * FROM orders ORDER BY amount DESC LIMIT 5',
        []
      )

      expect(result.rows.length).toBe(5)
      expect(result.rows[0].amount).toBe(19)
    })

    it('should handle GROUP BY across shards', async () => {
      // Insert categorized data
      await db.query('INSERT INTO orders (tenant_id, category, amount) VALUES ($1, $2, $3)', ['t1', 'electronics', 100])
      await db.query('INSERT INTO orders (tenant_id, category, amount) VALUES ($1, $2, $3)', ['t2', 'electronics', 200])
      await db.query('INSERT INTO orders (tenant_id, category, amount) VALUES ($1, $2, $3)', ['t3', 'clothing', 50])
      await db.query('INSERT INTO orders (tenant_id, category, amount) VALUES ($1, $2, $3)', ['t4', 'clothing', 75])

      const result = await db.query(
        'SELECT category, SUM(amount) as total FROM orders GROUP BY category ORDER BY category',
        []
      )

      expect(result.rows).toHaveLength(2)
      expect(result.rows.find((r: { category: string }) => r.category === 'electronics')?.total).toBe(300)
      expect(result.rows.find((r: { category: string }) => r.category === 'clothing')?.total).toBe(125)
    })

    it('should handle DISTINCT across shards', async () => {
      await db.query('INSERT INTO orders (tenant_id, status) VALUES ($1, $2)', ['t1', 'pending'])
      await db.query('INSERT INTO orders (tenant_id, status) VALUES ($1, $2)', ['t2', 'pending'])
      await db.query('INSERT INTO orders (tenant_id, status) VALUES ($1, $2)', ['t3', 'shipped'])
      await db.query('INSERT INTO orders (tenant_id, status) VALUES ($1, $2)', ['t4', 'delivered'])

      const result = await db.query(
        'SELECT DISTINCT status FROM orders ORDER BY status',
        []
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map((r: { status: string }) => r.status)).toEqual(['delivered', 'pending', 'shipped'])
    })

    it('should handle IN clause with keys on multiple shards', async () => {
      await db.query('INSERT INTO orders (tenant_id, order_id) VALUES ($1, $2)', ['t1', 'o1'])
      await db.query('INSERT INTO orders (tenant_id, order_id) VALUES ($1, $2)', ['t2', 'o2'])
      await db.query('INSERT INTO orders (tenant_id, order_id) VALUES ($1, $2)', ['t3', 'o3'])

      const result = await db.query(
        'SELECT * FROM orders WHERE tenant_id IN ($1, $2)',
        ['t1', 't3']
      )

      expect(result.rows).toHaveLength(2)
      expect(result.shardsQueried).toBeLessThanOrEqual(2) // Only queries relevant shards
    })

    it('should execute fan-out queries in parallel', async () => {
      const queryTimes: number[] = []

      const parallelDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
        onShardQuery: () => {
          queryTimes.push(Date.now())
        },
      })

      await parallelDb.query('SELECT * FROM orders', [])

      // All shard queries should start at approximately the same time (parallel)
      const firstQuery = Math.min(...queryTimes)
      const lastQuery = Math.max(...queryTimes)
      expect(lastQuery - firstQuery).toBeLessThan(50) // Within 50ms of each other

      await parallelDb.close()
    })

    it('should handle partial shard failures in fan-out', async () => {
      const failingShard = 5

      const flakyDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
        onShardQuery: (shardId) => {
          if (shardId === failingShard) {
            throw new Error('Shard unavailable')
          }
        },
      })

      // Should throw by default on partial failure
      await expect(
        flakyDb.query('SELECT * FROM orders', [])
      ).rejects.toThrow(/shard.*unavailable/i)

      await flakyDb.close()
    })

    it('should support partial results mode for fan-out queries', async () => {
      const failingShard = 5

      const flakyDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
        allowPartialResults: true,
        onShardQuery: (shardId) => {
          if (shardId === failingShard) {
            throw new Error('Shard unavailable')
          }
        },
      })

      const result = await flakyDb.query('SELECT * FROM orders', [])

      expect(result.shardsQueried).toBe(9) // 10 - 1 failed
      expect(result.partialResults).toBe(true)
      expect(result.failedShards).toContain(failingShard)

      await flakyDb.close()
    })
  })

  // ==========================================================================
  // EXEC METHOD (MULTI-SHARD DDL)
  // ==========================================================================

  describe('exec() - Multi-Shard DDL', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })
    })

    it('should execute DDL on all shards', async () => {
      await db.exec('CREATE TABLE IF NOT EXISTS orders (tenant_id TEXT, order_id TEXT, amount DECIMAL)')

      // Verify by querying each shard
      const result = await db.exec('SELECT COUNT(*) FROM information_schema.tables WHERE table_name = $1', ['orders'])

      // Should be created on all 10 shards
      expect(result.shardsAffected).toBe(10)
    })

    it('should execute CREATE INDEX on all shards', async () => {
      await db.exec('CREATE TABLE orders (tenant_id TEXT, amount DECIMAL)')
      await db.exec('CREATE INDEX idx_orders_amount ON orders(amount)')

      expect(true).toBe(true) // Should not throw
    })

    it('should handle DDL failure on some shards', async () => {
      // First create table on all shards
      await db.exec('CREATE TABLE test_ddl (id TEXT)')

      // Try to create again - should fail on shards where it exists
      await expect(
        db.exec('CREATE TABLE test_ddl (id TEXT)')
      ).rejects.toThrow(/already exists|duplicate/i)
    })

    it('should support IF NOT EXISTS for idempotent DDL', async () => {
      await db.exec('CREATE TABLE IF NOT EXISTS idempotent_test (id TEXT)')
      await db.exec('CREATE TABLE IF NOT EXISTS idempotent_test (id TEXT)')

      // Should not throw
      expect(true).toBe(true)
    })

    it('should execute ALTER TABLE on all shards', async () => {
      await db.exec('CREATE TABLE alter_test (id TEXT)')
      await db.exec('ALTER TABLE alter_test ADD COLUMN new_col TEXT')

      // Verify column exists on all shards by inserting data
      await db.query(
        'INSERT INTO alter_test (id, new_col, tenant_id) VALUES ($1, $2, $3)',
        ['id-1', 'value', 'tenant-1']
      )

      const result = await db.query(
        'SELECT new_col FROM alter_test WHERE tenant_id = $1',
        ['tenant-1']
      )

      expect(result.rows[0].new_col).toBe('value')
    })
  })

  // ==========================================================================
  // TRANSACTIONS (SINGLE-SHARD ONLY)
  // ==========================================================================

  describe('transaction() - Single-Shard Transactions', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })
    })

    it('should execute transaction on single shard', async () => {
      await db.exec('CREATE TABLE accounts (tenant_id TEXT, account_id TEXT, balance DECIMAL)')
      await db.query(
        'INSERT INTO accounts (tenant_id, account_id, balance) VALUES ($1, $2, $3)',
        ['tenant-tx', 'acc-1', 100]
      )
      await db.query(
        'INSERT INTO accounts (tenant_id, account_id, balance) VALUES ($1, $2, $3)',
        ['tenant-tx', 'acc-2', 50]
      )

      await db.transaction('tenant-tx', async (tx) => {
        await tx.query(
          'UPDATE accounts SET balance = balance - $2 WHERE tenant_id = $1 AND account_id = $3',
          ['tenant-tx', 25, 'acc-1']
        )
        await tx.query(
          'UPDATE accounts SET balance = balance + $2 WHERE tenant_id = $1 AND account_id = $3',
          ['tenant-tx', 25, 'acc-2']
        )
      })

      const result = await db.query(
        'SELECT * FROM accounts WHERE tenant_id = $1 ORDER BY account_id',
        ['tenant-tx']
      )

      expect(result.rows[0].balance).toBe(75)
      expect(result.rows[1].balance).toBe(75)
    })

    it('should rollback transaction on error', async () => {
      await db.exec('CREATE TABLE tx_rollback (tenant_id TEXT, value INT)')
      await db.query(
        'INSERT INTO tx_rollback (tenant_id, value) VALUES ($1, $2)',
        ['tenant-rb', 100]
      )

      await expect(
        db.transaction('tenant-rb', async (tx) => {
          await tx.query(
            'UPDATE tx_rollback SET value = $2 WHERE tenant_id = $1',
            ['tenant-rb', 200]
          )
          throw new Error('Simulated failure')
        })
      ).rejects.toThrow('Simulated failure')

      // Value should be unchanged
      const result = await db.query(
        'SELECT value FROM tx_rollback WHERE tenant_id = $1',
        ['tenant-rb']
      )

      expect(result.rows[0].value).toBe(100)
    })

    it('should reject transaction spanning multiple shards', async () => {
      await expect(
        db.transaction(['tenant-1', 'tenant-2'], async (tx) => {
          await tx.query('SELECT 1', [])
        })
      ).rejects.toThrow(/multi-shard|cross-shard|not supported/i)
    })

    it('should require shard key for transaction', async () => {
      await expect(
        db.transaction(null as unknown as string, async () => {})
      ).rejects.toThrow(/shard key|required/i)
    })

    it('should isolate transaction from other queries on same shard', async () => {
      await db.exec('CREATE TABLE isolation_test (tenant_id TEXT, counter INT)')
      await db.query(
        'INSERT INTO isolation_test (tenant_id, counter) VALUES ($1, $2)',
        ['tenant-iso', 0]
      )

      // Start transaction but don't commit yet
      const txPromise = db.transaction('tenant-iso', async (tx) => {
        await tx.query(
          'UPDATE isolation_test SET counter = 100 WHERE tenant_id = $1',
          ['tenant-iso']
        )

        // Read from outside transaction should see old value (isolation)
        const outsideResult = await db.query(
          'SELECT counter FROM isolation_test WHERE tenant_id = $1',
          ['tenant-iso']
        )

        // Depending on isolation level, this might see 0 or 100
        // For READ COMMITTED, should see 0
        return outsideResult.rows[0].counter
      })

      const outsideValue = await txPromise

      // With proper isolation, outside read should see original value
      expect(outsideValue).toBe(0)
    })
  })

  // ==========================================================================
  // REBALANCING
  // ==========================================================================

  describe('rebalance() - Shard Rebalancing', () => {
    beforeEach(async () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })

      // Seed some data
      await db.exec('CREATE TABLE rebalance_test (tenant_id TEXT PRIMARY KEY, data TEXT)')
      for (let i = 0; i < 100; i++) {
        await db.query(
          'INSERT INTO rebalance_test (tenant_id, data) VALUES ($1, $2)',
          [`tenant-${i}`, `data-${i}`]
        )
      }
    })

    it('should add new shards without data loss', async () => {
      // Count total records before
      const beforeResult = await db.query('SELECT COUNT(*) as count FROM rebalance_test', [])
      const beforeCount = beforeResult.rows[0].count

      // Rebalance to 15 shards
      const result = await db.rebalance(15)

      expect(result.success).toBe(true)
      expect(result.newShardCount).toBe(15)

      // Count total records after
      const afterResult = await db.query('SELECT COUNT(*) as count FROM rebalance_test', [])
      const afterCount = afterResult.rows[0].count

      expect(afterCount).toBe(beforeCount)
    })

    it('should remove shards without data loss', async () => {
      const beforeResult = await db.query('SELECT COUNT(*) as count FROM rebalance_test', [])
      const beforeCount = beforeResult.rows[0].count

      // Rebalance to 5 shards
      const result = await db.rebalance(5)

      expect(result.success).toBe(true)
      expect(result.newShardCount).toBe(5)

      const afterResult = await db.query('SELECT COUNT(*) as count FROM rebalance_test', [])
      expect(afterResult.rows[0].count).toBe(beforeCount)
    })

    it('should minimize data movement during rebalance', async () => {
      // Rebalance from 10 to 11 shards
      const result = await db.rebalance(11)

      // With consistent hashing, only ~1/11 of data should move
      // Allow 20% variance
      const expectedMoveRatio = 1 / 11
      const actualMoveRatio = result.rowsMoved / 100 // 100 total rows

      expect(actualMoveRatio).toBeLessThan(expectedMoveRatio + 0.2)
    })

    it('should report rebalance progress', async () => {
      const progressUpdates: number[] = []

      const result = await db.rebalance(15, {
        onProgress: (progress) => {
          progressUpdates.push(progress)
        },
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
      expect(result.success).toBe(true)
    })

    it('should be atomic - rollback on failure', async () => {
      // Simulate failure during rebalance
      const failingDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
        onDataMove: (fromShard, toShard, rowCount) => {
          if (rowCount > 5) {
            throw new Error('Simulated move failure')
          }
        },
      })

      await failingDb.exec('CREATE TABLE fail_test (tenant_id TEXT PRIMARY KEY, data TEXT)')
      for (let i = 0; i < 50; i++) {
        await failingDb.query(
          'INSERT INTO fail_test (tenant_id, data) VALUES ($1, $2)',
          [`tenant-${i}`, `data-${i}`]
        )
      }

      await expect(
        failingDb.rebalance(15)
      ).rejects.toThrow(/move failure/i)

      // Should still have original shard count
      expect(failingDb.getShardCount()).toBe(10)

      await failingDb.close()
    })

    it('should maintain query routing during rebalance', async () => {
      // Start rebalance in background
      const rebalancePromise = db.rebalance(15)

      // Queries should still work during rebalance
      const result = await db.query(
        'SELECT * FROM rebalance_test WHERE tenant_id = $1',
        ['tenant-50']
      )

      expect(result.rows).toHaveLength(1)

      await rebalancePromise
    })

    it('should handle rebalance with no data', async () => {
      const emptyDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 5,
          algorithm: 'consistent',
        },
      })

      const result = await emptyDb.rebalance(10)

      expect(result.success).toBe(true)
      expect(result.rowsMoved).toBe(0)

      await emptyDb.close()
    })

    it('should preserve data integrity after multiple rebalances', async () => {
      // Collect all data before
      const beforeData = new Map<string, string>()
      for (let i = 0; i < 100; i++) {
        const result = await db.query(
          'SELECT * FROM rebalance_test WHERE tenant_id = $1',
          [`tenant-${i}`]
        )
        beforeData.set(result.rows[0].tenant_id, result.rows[0].data)
      }

      // Multiple rebalances
      await db.rebalance(15)
      await db.rebalance(8)
      await db.rebalance(20)
      await db.rebalance(10)

      // Verify all data is intact
      for (const [tenantId, expectedData] of beforeData) {
        const result = await db.query(
          'SELECT * FROM rebalance_test WHERE tenant_id = $1',
          [tenantId]
        )
        expect(result.rows[0].data).toBe(expectedData)
      }
    })

    it('should update shard count after successful rebalance', async () => {
      expect(db.getShardCount()).toBe(10)

      await db.rebalance(25)

      expect(db.getShardCount()).toBe(25)
    })
  })

  // ==========================================================================
  // SHARD ROUTER
  // ==========================================================================

  describe('ShardRouter', () => {
    it('should create router with consistent hashing', () => {
      const router = new ShardRouter({
        count: 100,
        algorithm: 'consistent',
        virtualNodesPerShard: 150,
      })

      expect(router).toBeDefined()
      expect(router.getShardCount()).toBe(100)
    })

    it('should return consistent shard for same key', () => {
      const router = new ShardRouter({
        count: 50,
        algorithm: 'consistent',
      })

      const shard1 = router.getShardForKey('test-key-123')
      const shard2 = router.getShardForKey('test-key-123')
      const shard3 = router.getShardForKey('test-key-123')

      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
    })

    it('should distribute keys across all shards', () => {
      const router = new ShardRouter({
        count: 10,
        algorithm: 'consistent',
      })

      const shards = new Set<number>()
      for (let i = 0; i < 10000; i++) {
        shards.add(router.getShardForKey(`key-${i}`))
      }

      // All shards should be used
      expect(shards.size).toBe(10)
    })

    it('should calculate affected shards for key range', () => {
      const router = new ShardRouter({
        count: 10,
        algorithm: 'range',
      })

      const affectedShards = router.getShardsForKeyRange('a', 'c')

      expect(affectedShards.length).toBeGreaterThan(0)
      expect(affectedShards.length).toBeLessThanOrEqual(10)
    })

    it('should get all shards for fan-out query', () => {
      const router = new ShardRouter({
        count: 25,
        algorithm: 'consistent',
      })

      const allShards = router.getAllShards()

      expect(allShards.length).toBe(25)
      expect(new Set(allShards).size).toBe(25)
    })

    it('should calculate minimal movement for rebalance', () => {
      const router = new ShardRouter({
        count: 10,
        algorithm: 'consistent',
      })

      const movement = router.calculateRebalanceMovement(12)

      expect(movement.shardsToAdd).toBe(2)
      expect(movement.shardsToRemove).toBe(0)
      expect(movement.estimatedDataMovementPercent).toBeLessThan(20) // ~2/12 = 16.7%
    })

    it('should handle edge case of single shard', () => {
      const router = new ShardRouter({
        count: 1,
        algorithm: 'consistent',
      })

      // All keys should go to shard 0
      for (let i = 0; i < 100; i++) {
        expect(router.getShardForKey(`key-${i}`)).toBe(0)
      }
    })

    it('should serialize and deserialize router state', () => {
      const router = new ShardRouter({
        count: 100,
        algorithm: 'consistent',
        virtualNodesPerShard: 150,
      })

      // Record some key mappings
      const mappings = new Map<string, number>()
      for (let i = 0; i < 50; i++) {
        const key = `key-${i}`
        mappings.set(key, router.getShardForKey(key))
      }

      // Serialize and deserialize
      const serialized = router.serialize()
      const restored = ShardRouter.deserialize(serialized)

      // Verify mappings are preserved
      for (const [key, expectedShard] of mappings) {
        expect(restored.getShardForKey(key)).toBe(expectedShard)
      }
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })
    })

    it('should throw on query with missing shard key in strict mode', async () => {
      const strictDb = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
          strictMode: true,
        },
      })

      await expect(
        strictDb.query('SELECT * FROM orders WHERE amount > $1', [100])
      ).rejects.toThrow(/shard key|required|strict mode/i)

      await strictDb.close()
    })

    it('should handle shard connection failures', async () => {
      const flakyShard = 3

      const flakyEnv = createMockEnv()
      const originalGet = flakyEnv.EDGE_POSTGRES_SHARDS.get
      flakyEnv.EDGE_POSTGRES_SHARDS.get = (id) => {
        const stub = originalGet(id)
        if (id.toString().includes(`shard-${flakyShard}`)) {
          return {
            fetch: async () => { throw new Error('Connection refused') },
          }
        }
        return stub
      }

      const flakyDb = new ShardedPostgres(ctx, flakyEnv, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })

      // Query to the flaky shard should fail
      const keyOnFlakyShard = await findKeyForShard(flakyDb, flakyShard)

      await expect(
        flakyDb.query(
          'SELECT * FROM orders WHERE tenant_id = $1',
          [keyOnFlakyShard]
        )
      ).rejects.toThrow(/connection refused|shard unavailable/i)

      await flakyDb.close()
    })

    it('should timeout on slow shard queries', async () => {
      const slowEnv = createMockEnv()
      slowEnv.EDGE_POSTGRES_SHARDS.get = (id) => ({
        fetch: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000))
          return new Response(JSON.stringify({ rows: [] }))
        },
      })

      const slowDb = new ShardedPostgres(ctx, slowEnv, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
        queryTimeout: 1000,
      })

      await expect(
        slowDb.query('SELECT * FROM orders WHERE tenant_id = $1', ['tenant-1'])
      ).rejects.toThrow(/timeout/i)

      await slowDb.close()
    })

    it('should provide helpful error for invalid shard key type', async () => {
      await expect(
        db.query(
          'INSERT INTO orders (tenant_id) VALUES ($1)',
          [{ invalid: 'object' }]
        )
      ).rejects.toThrow(/shard key|invalid type|string|number/i)
    })

    it('should handle concurrent rebalance attempts', async () => {
      // Start first rebalance
      const rebalance1 = db.rebalance(15)

      // Try to start second rebalance while first is in progress
      await expect(db.rebalance(20)).rejects.toThrow(/rebalance.*in progress/i)

      await rebalance1
    })
  })

  // ==========================================================================
  // CLOSE METHOD
  // ==========================================================================

  describe('close() - Cleanup', () => {
    it('should close all shard connections', async () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })

      // Make some queries to establish connections
      await db.query('SELECT 1 WHERE tenant_id = $1', ['t1'])
      await db.query('SELECT 1 WHERE tenant_id = $1', ['t2'])

      await db.close()

      // Queries after close should fail
      await expect(
        db.query('SELECT 1 WHERE tenant_id = $1', ['t1'])
      ).rejects.toThrow(/closed/i)
    })

    it('should be safe to call close multiple times', async () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })

      await db.close()
      await db.close()
      await db.close()

      expect(true).toBe(true)
    })

    it('should wait for pending queries before closing', async () => {
      db = new ShardedPostgres(ctx, env, {
        sharding: {
          key: 'tenant_id',
          count: 10,
          algorithm: 'consistent',
        },
      })

      // Start a long-running query
      const queryPromise = db.query('SELECT * FROM orders', [])

      // Close should wait for query to complete
      const closePromise = db.close()

      // Both should complete without error
      await Promise.all([queryPromise.catch(() => {}), closePromise])

      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find a key that routes to a specific shard
 */
async function findKeyForShard(db: ShardedPostgres, targetShard: number): Promise<string> {
  for (let i = 0; i < 10000; i++) {
    const key = `tenant-search-${i}`
    const shard = await db.getShardForKey(key)
    if (shard === targetShard) {
      return key
    }
  }
  throw new Error(`Could not find key for shard ${targetShard}`)
}
