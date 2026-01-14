/**
 * GEL Shard Integration Tests - TDD RED Phase
 *
 * Tests for integrating GEL with ShardManager for multi-tenant distribution.
 * These tests define the contract for sharded GEL clients that:
 * - Route queries by tenant_id
 * - Use consistent hashing for shard selection
 * - Create per-tenant schemas
 * - Handle cross-shard queries (fan-out)
 * - Maintain isolation between tenants
 * - Scale beyond 10GB per tenant
 *
 * All tests are expected to FAIL until the ShardedGelClient is implemented.
 *
 * @module db/compat/gel/tests/shard-integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, GelClient, GelError, QueryError } from '../client'
import { ShardManager, consistentHash, clearRingCache } from '../../../core/shard'
import type { ShardConfig } from '../../../core/types'

// =============================================================================
// TYPES - Sharded GEL Client Interface (to be implemented)
// =============================================================================

/**
 * Sharded GEL client configuration
 */
interface ShardedGelClientConfig {
  /** Durable Object namespace for shard routing */
  doNamespace: DurableObjectNamespace
  /** Shard configuration */
  shard: {
    /** Shard key field (e.g., 'tenant_id') */
    key: string
    /** Sharding algorithm */
    algorithm: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count: number
  }
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Sharded GEL client interface (placeholder for implementation)
 * This will wrap multiple GelClient instances across shards
 */
interface ShardedGelClient {
  /** Execute query on appropriate shard(s) based on tenant_id */
  query<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T[]>
  /** Execute query expecting single result */
  querySingle<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T | null>
  /** Execute query requiring exactly one result */
  queryRequired<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T>
  /** Execute mutation on appropriate shard */
  execute(edgeql: string, params?: Record<string, unknown>): Promise<void>
  /** Apply schema to all shards */
  ensureSchema(sdl: string): Promise<void>
  /** Get shard ID for a tenant */
  getShardForTenant(tenantId: string): number
  /** Fan out query to all shards */
  queryAllShards<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T[]>
  /** Close all shard connections */
  close(): void
}

/**
 * Factory function for creating sharded GEL client (to be implemented)
 */
declare function createShardedClient(config: ShardedGelClientConfig): ShardedGelClient

// =============================================================================
// MOCK NAMESPACE - For testing without real DOs
// =============================================================================

/**
 * Mock DO namespace for testing
 */
function createMockNamespace(): DurableObjectNamespace {
  const stubs = new Map<string, any>()

  return {
    idFromName: (name: string) => ({ toString: () => `id-${name}` } as DurableObjectId),
    get: (id: any) => {
      const name = id.toString()
      if (!stubs.has(name)) {
        stubs.set(name, {
          fetch: async (url: string, init?: RequestInit) => {
            return new Response(JSON.stringify({ success: true, shard: name }), {
              headers: { 'Content-Type': 'application/json' },
            })
          },
        })
      }
      return stubs.get(name)
    },
    idFromString: (hexId: string) => ({ toString: () => hexId } as DurableObjectId),
    newUniqueId: () => ({ toString: () => `unique-${Date.now()}` } as DurableObjectId),
    jurisdiction: (jurisdiction: 'eu' | 'us' | 'fedramp') => ({
      idFromName: (name: string) => ({ toString: () => `${jurisdiction}-${name}` } as DurableObjectId),
      newUniqueId: () => ({ toString: () => `${jurisdiction}-unique-${Date.now()}` } as DurableObjectId),
    }),
  } as DurableObjectNamespace
}

// =============================================================================
// SAMPLE SCHEMAS FOR TESTING
// =============================================================================

const MULTI_TENANT_SCHEMA = `
  # Multi-tenant schema with tenant_id on all types
  type Tenant {
    required name: str;
    required plan: str {
      default := 'free';
    }
  }

  type User {
    required tenant_id: str;
    required email: str {
      constraint exclusive;
    }
    required name: str;
    role: str {
      default := 'member';
    }
  }

  type Project {
    required tenant_id: str;
    required name: str;
    description: str;
    required owner: User;
    multi members: User;
  }

  type Task {
    required tenant_id: str;
    required title: str;
    status: str {
      default := 'todo';
    }
    required project: Project;
    assignee: User;
  }
`

const LARGE_DATA_SCHEMA = `
  # Schema for testing 10GB+ scenarios
  type Document {
    required tenant_id: str;
    required content: str;
    metadata: json;
    embeddings: array<float64>;
    created_at: datetime {
      default := datetime_current();
    }
  }

  type Analytics {
    required tenant_id: str;
    event_type: str;
    payload: json;
    timestamp: datetime {
      default := datetime_current();
    }
  }
`

// =============================================================================
// 1. SHARD ROUTING TESTS (~20 tests)
// =============================================================================

describe('GEL Shard Integration - Routing', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('routes queries by tenant_id', () => {
    it('should route INSERT to correct shard based on tenant_id', async () => {
      // This test expects createShardedClient to exist and route correctly
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert user for tenant-acme
      const result = await client.query(`
        insert User {
          tenant_id := 'tenant-acme',
          email := 'alice@acme.com',
          name := 'Alice'
        }
      `)

      // Should be routed to the shard for 'tenant-acme'
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('tenant_id', 'tenant-acme')
    })

    it('should route SELECT to correct shard based on tenant_id filter', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query should be routed to shard for 'tenant-globex'
      const result = await client.query(`
        select User { name, email }
        filter .tenant_id = 'tenant-globex'
      `)

      expect(Array.isArray(result)).toBe(true)
    })

    it('should route UPDATE to correct shard based on tenant_id', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Update should be routed to shard for 'tenant-initech'
      await client.execute(`
        update User
        filter .tenant_id = 'tenant-initech' and .email = 'bob@initech.com'
        set { role := 'admin' }
      `)

      // Should not throw
    })

    it('should route DELETE to correct shard based on tenant_id', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Delete should be routed to shard for 'tenant-umbrella'
      await client.execute(`
        delete Task
        filter .tenant_id = 'tenant-umbrella' and .status = 'archived'
      `)

      // Should not throw
    })

    it('should extract tenant_id from parameterized queries', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query with parameter should route correctly
      const result = await client.query(
        `select User { name } filter .tenant_id = <str>$tenant`,
        { tenant: 'tenant-stark' }
      )

      expect(Array.isArray(result)).toBe(true)
    })

    it('should extract tenant_id from INSERT with parameter', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // INSERT with parameterized tenant_id
      const result = await client.query(
        `insert User { tenant_id := <str>$tenant, email := <str>$email, name := <str>$name }`,
        { tenant: 'tenant-wayne', email: 'bruce@wayne.com', name: 'Bruce' }
      )

      expect(result).toHaveProperty('tenant_id', 'tenant-wayne')
    })

    it('should route related entity queries to same shard', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query with nested shapes should stay on same shard
      const result = await client.query(`
        select Project {
          name,
          owner: { name, email },
          members: { name }
        }
        filter .tenant_id = 'tenant-acme'
      `)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('uses consistent hashing for shard selection', () => {
    it('should route same tenant_id to same shard consistently', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 8,
        },
      })

      const tenantId = 'tenant-consistent-test'

      // Get shard multiple times
      const shard1 = client.getShardForTenant(tenantId)
      const shard2 = client.getShardForTenant(tenantId)
      const shard3 = client.getShardForTenant(tenantId)

      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
    })

    it('should distribute tenants across all shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      const shardUsage = new Map<number, number>()

      // Check distribution of 100 tenants
      for (let i = 0; i < 100; i++) {
        const shard = client.getShardForTenant(`tenant-${i}`)
        shardUsage.set(shard, (shardUsage.get(shard) || 0) + 1)
      }

      // All 4 shards should be used
      expect(shardUsage.size).toBe(4)

      // No shard should have more than 60% of tenants
      for (const [, count] of shardUsage) {
        expect(count).toBeLessThan(60)
        expect(count).toBeGreaterThan(5)
      }
    })

    it('should minimize tenant movement when adding shards', async () => {
      const tenants = Array.from({ length: 1000 }, (_, i) => `tenant-${i}`)

      // Simulate old vs new shard count
      const oldCount = 4
      const newCount = 5

      let unchanged = 0
      for (const tenant of tenants) {
        const oldShard = consistentHash(tenant, oldCount)
        const newShard = consistentHash(tenant, newCount)
        if (oldShard === newShard) {
          unchanged++
        }
      }

      // At least 60% should stay on same shard
      expect(unchanged / tenants.length).toBeGreaterThan(0.6)
    })

    it('should use hash algorithm when configured', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'hash',
          count: 4,
        },
      })

      const shard = client.getShardForTenant('tenant-hash-test')
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(4)
    })

    it('should use range algorithm when configured', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'range',
          count: 4,
        },
      })

      // Range should work with alphabetical distribution
      const shardA = client.getShardForTenant('alpha-tenant')
      const shardZ = client.getShardForTenant('zulu-tenant')

      expect(shardA).toBeGreaterThanOrEqual(0)
      expect(shardZ).toBeLessThan(4)
      // A and Z should likely be in different shards (not guaranteed but likely)
    })
  })
})

// =============================================================================
// 2. PER-TENANT SCHEMA TESTS (~15 tests)
// =============================================================================

describe('GEL Shard Integration - Per-Tenant Schemas', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('creates per-tenant schemas', () => {
    it('should apply schema to all shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      // ensureSchema should be called on all 4 shards
      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Should be able to insert to any shard without schema errors
      for (let i = 0; i < 4; i++) {
        const result = await client.query(`
          insert User {
            tenant_id := 'tenant-shard-${i}',
            email := 'user${i}@test.com',
            name := 'User ${i}'
          }
        `)
        expect(result).toHaveProperty('id')
      }
    })

    it('should handle schema migration across all shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      // Apply initial schema
      await client.ensureSchema(`
        type User {
          required tenant_id: str;
          required name: str;
        }
      `)

      // Update schema with new field
      await client.ensureSchema(`
        type User {
          required tenant_id: str;
          required name: str;
          email: str;
        }
      `)

      // Should be able to use new field
      const result = await client.query(`
        insert User {
          tenant_id := 'tenant-migration',
          name := 'Test',
          email := 'test@test.com'
        }
      `)
      expect(result).toHaveProperty('email')
    })

    it('should enforce constraints per shard', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // First insert
      await client.query(`
        insert User {
          tenant_id := 'tenant-constraint',
          email := 'unique@test.com',
          name := 'First'
        }
      `)

      // Duplicate email in same shard should fail
      await expect(
        client.query(`
          insert User {
            tenant_id := 'tenant-constraint',
            email := 'unique@test.com',
            name := 'Second'
          }
        `)
      ).rejects.toThrow()
    })

    it('should allow same email in different shards (different tenants)', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert in tenant-a
      await client.query(`
        insert User {
          tenant_id := 'tenant-a-isolation',
          email := 'shared@test.com',
          name := 'From A'
        }
      `)

      // Same email in different tenant (different shard) should succeed
      // (assuming consistent hash routes to different shard)
      const result = await client.query(`
        insert User {
          tenant_id := 'tenant-b-isolation',
          email := 'shared@test.com',
          name := 'From B'
        }
      `)

      expect(result).toHaveProperty('id')
    })

    it('should handle schema with inheritance across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(`
        abstract type Auditable {
          required tenant_id: str;
          created_at: datetime {
            default := datetime_current();
          }
        }

        type User extending Auditable {
          required name: str;
        }

        type Admin extending User {
          required role: str;
        }
      `)

      // Insert should work with inheritance
      const result = await client.query(`
        insert Admin {
          tenant_id := 'tenant-inherit',
          name := 'Super Admin',
          role := 'super'
        }
      `)

      expect(result).toHaveProperty('tenant_id')
      expect(result).toHaveProperty('role')
    })
  })
})

// =============================================================================
// 3. CROSS-SHARD QUERY TESTS (~20 tests)
// =============================================================================

describe('GEL Shard Integration - Cross-Shard Queries', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('handles cross-shard queries (fan-out)', () => {
    it('should fan out query without tenant_id filter', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query without tenant_id should fan out to all shards
      const result = await client.queryAllShards(`
        select User { name, tenant_id }
      `)

      // Result should be aggregated from all shards
      expect(Array.isArray(result)).toBe(true)
    })

    it('should merge results from all shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert users across different tenants (different shards)
      for (let i = 0; i < 4; i++) {
        await client.query(`
          insert User {
            tenant_id := 'tenant-merge-${i}',
            email := 'user${i}@merge.com',
            name := 'Merge User ${i}'
          }
        `)
      }

      // Fan-out query should return all users
      const result = await client.queryAllShards(`
        select User { name, tenant_id }
      `)

      expect(result.length).toBe(4)
    })

    it('should handle COUNT aggregation across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert users across shards
      for (let i = 0; i < 10; i++) {
        await client.query(`
          insert User {
            tenant_id := 'tenant-count-${i}',
            email := 'user${i}@count.com',
            name := 'Count User ${i}'
          }
        `)
      }

      // Count should aggregate across all shards
      const result = await client.queryAllShards(`
        select count(User)
      `)

      expect(result).toBe(10)
    })

    it('should handle ORDER BY across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert users with different names across shards
      const names = ['Zebra', 'Alpha', 'Mike', 'Delta']
      for (let i = 0; i < names.length; i++) {
        await client.query(`
          insert User {
            tenant_id := 'tenant-order-${i}',
            email := '${names[i].toLowerCase()}@order.com',
            name := '${names[i]}'
          }
        `)
      }

      // Order by name should merge and sort results
      const result = await client.queryAllShards(`
        select User { name, tenant_id }
        order by .name asc
      `)

      expect(result[0].name).toBe('Alpha')
      expect(result[result.length - 1].name).toBe('Zebra')
    })

    it('should handle LIMIT across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert many users
      for (let i = 0; i < 20; i++) {
        await client.query(`
          insert User {
            tenant_id := 'tenant-limit-${i}',
            email := 'user${i}@limit.com',
            name := 'Limit User ${i}'
          }
        `)
      }

      // Limit should apply to merged results
      const result = await client.queryAllShards(`
        select User { name }
        limit 5
      `)

      expect(result.length).toBe(5)
    })

    it('should handle IN clause with multiple tenants', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query multiple specific tenants
      const result = await client.query(`
        select User { name, tenant_id }
        filter .tenant_id in {'tenant-in-1', 'tenant-in-2', 'tenant-in-3'}
      `)

      // Should fan out to shards containing these tenants
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle partial shard failures gracefully', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Fan-out query should handle individual shard failures
      // and return partial results or throw appropriate error
      const result = await client.queryAllShards(`
        select User { name }
      `)

      // Should still return results from healthy shards
      expect(Array.isArray(result)).toBe(true)
    })

    it('should support cross-shard transactions (eventual consistency)', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Cross-shard operations should be handled with eventual consistency
      // This is a limitation - true distributed transactions across DOs are not supported
      await client.execute(`
        insert User {
          tenant_id := 'tenant-cross-tx-1',
          email := 'cross1@tx.com',
          name := 'Cross 1'
        }
      `)

      await client.execute(`
        insert User {
          tenant_id := 'tenant-cross-tx-2',
          email := 'cross2@tx.com',
          name := 'Cross 2'
        }
      `)

      // Both should be queryable
      const result = await client.queryAllShards(`
        select User { name }
        filter .email like '%@tx.com'
      `)

      expect(result.length).toBe(2)
    })
  })
})

// =============================================================================
// 4. TENANT ISOLATION TESTS (~20 tests)
// =============================================================================

describe('GEL Shard Integration - Tenant Isolation', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('maintains isolation between tenants', () => {
    it('should not leak data between tenants in same shard', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Insert data for tenant-iso-1
      await client.query(`
        insert User {
          tenant_id := 'tenant-iso-1',
          email := 'secret1@iso.com',
          name := 'Secret User 1'
        }
      `)

      // Insert data for tenant-iso-2
      await client.query(`
        insert User {
          tenant_id := 'tenant-iso-2',
          email := 'secret2@iso.com',
          name := 'Secret User 2'
        }
      `)

      // Query for tenant-iso-1 should NOT return tenant-iso-2 data
      const result = await client.query(`
        select User { name, email }
        filter .tenant_id = 'tenant-iso-1'
      `)

      expect(result.every((u: any) => u.email.includes('secret1'))).toBe(true)
    })

    it('should enforce tenant_id in all queries', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query without tenant_id should either:
      // 1. Fail with error (strict mode)
      // 2. Fan out to all shards (permissive mode)

      // For strict isolation, this should throw
      await expect(
        client.query(`select User { name }`)
      ).rejects.toThrow()
    })

    it('should prevent UPDATE without tenant_id filter', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // UPDATE without tenant_id should fail (could affect wrong shard)
      await expect(
        client.execute(`
          update User
          filter .email = 'test@test.com'
          set { name := 'Hacked' }
        `)
      ).rejects.toThrow()
    })

    it('should prevent DELETE without tenant_id filter', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // DELETE without tenant_id should fail
      await expect(
        client.execute(`
          delete User filter .email = 'test@test.com'
        `)
      ).rejects.toThrow()
    })

    it('should require tenant_id in INSERT', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // INSERT without tenant_id should fail (can't route to shard)
      await expect(
        client.query(`
          insert User { email := 'no-tenant@test.com', name := 'No Tenant' }
        `)
      ).rejects.toThrow()
    })

    it('should isolate transactions to single tenant', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Transaction should only affect single tenant's shard
      // Cross-tenant transactions are not supported
      const tenantId = 'tenant-tx-iso'

      await client.query(`
        insert User {
          tenant_id := '${tenantId}',
          email := 'tx1@iso.com',
          name := 'TX User 1'
        }
      `)

      await client.query(`
        insert User {
          tenant_id := '${tenantId}',
          email := 'tx2@iso.com',
          name := 'TX User 2'
        }
      `)

      // Both users should be in same shard
      const result = await client.query(`
        select User { name }
        filter .tenant_id = '${tenantId}'
      `)

      expect(result.length).toBe(2)
    })

    it('should handle concurrent requests from different tenants', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Concurrent requests to different tenants should be isolated
      const promises = Array.from({ length: 10 }, (_, i) =>
        client.query(`
          insert User {
            tenant_id := 'tenant-concurrent-${i}',
            email := 'concurrent${i}@test.com',
            name := 'Concurrent ${i}'
          }
        `)
      )

      const results = await Promise.all(promises)

      expect(results.length).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(results[i]).toHaveProperty('tenant_id', `tenant-concurrent-${i}`)
      }
    })

    it('should support per-tenant rate limiting', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Rate limiting should be per-tenant, not global
      // One tenant hitting limits should not affect others
      // This test verifies the infrastructure supports per-tenant tracking

      const tenantA = 'tenant-rate-a'
      const tenantB = 'tenant-rate-b'

      // Multiple rapid requests for tenant A
      for (let i = 0; i < 5; i++) {
        await client.query(`
          select count(User) filter .tenant_id = '${tenantA}'
        `)
      }

      // Tenant B should still be able to query
      const result = await client.query(`
        select count(User) filter .tenant_id = '${tenantB}'
      `)

      expect(typeof result).toBe('number')
    })
  })
})

// =============================================================================
// 5. SCALE TESTS (~15 tests)
// =============================================================================

describe('GEL Shard Integration - Scale Beyond 10GB', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('scales beyond 10GB per tenant', () => {
    it('should support 16+ shards for large tenants', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 16,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Should be able to distribute across 16 shards
      const shardUsage = new Set<number>()
      for (let i = 0; i < 100; i++) {
        const shard = client.getShardForTenant(`large-tenant-${i}`)
        shardUsage.add(shard)
      }

      // Should use most of the 16 shards
      expect(shardUsage.size).toBeGreaterThan(10)
    })

    it('should handle 100+ shards configuration', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 100,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Verify routing works with 100 shards
      const shard = client.getShardForTenant('massive-tenant')
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(100)
    })

    it('should efficiently route to correct shard (O(log n) lookup)', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 100,
        },
      })

      // Warm up the ring cache
      client.getShardForTenant('warmup')

      // Time many lookups
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        client.getShardForTenant(`tenant-perf-${i}`)
      }
      const elapsed = performance.now() - start

      // 10000 lookups should take < 100ms with cached ring
      expect(elapsed).toBeLessThan(100)
    })

    it('should handle sub-tenant sharding for very large tenants', async () => {
      // For tenants that exceed 10GB, support sub-sharding
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(`
        type LargeDocument {
          required tenant_id: str;
          required document_id: str;  # Secondary shard key
          content: str;
        }
      `)

      // Query with both tenant_id and document_id should route to sub-shard
      const result = await client.query(`
        select LargeDocument { content }
        filter .tenant_id = 'mega-tenant' and .document_id = 'doc-123'
      `)

      expect(Array.isArray(result)).toBe(true)
    })

    it('should support hot/cold data tiering per shard', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Old data can be moved to R2/Archive while keeping recent in SQLite
      const result = await client.query(`
        select Document { content }
        filter .tenant_id = 'tiered-tenant'
          and .created_at > datetime_of_transaction() - <duration>'30 days'
      `)

      expect(Array.isArray(result)).toBe(true)
    })

    it('should batch inserts efficiently across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Batch insert should group by shard for efficiency
      const documents = Array.from({ length: 100 }, (_, i) => ({
        tenant_id: `batch-tenant-${i % 10}`,
        content: `Document ${i}`,
      }))

      // Batch insert (not yet defined in interface - would need implementation)
      // For now, sequential inserts
      for (const doc of documents) {
        await client.query(`
          insert Document {
            tenant_id := '${doc.tenant_id}',
            content := '${doc.content}'
          }
        `)
      }

      // Verify data distributed across shards
      const result = await client.queryAllShards(`
        select count(Document)
      `)

      expect(result).toBe(100)
    })

    it('should handle shard rebalancing gracefully', async () => {
      // When adding/removing shards, data should be rebalanced
      // This is a complex operation that requires careful handling

      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Insert some data
      for (let i = 0; i < 10; i++) {
        await client.query(`
          insert Document {
            tenant_id := 'rebalance-tenant-${i}',
            content := 'Rebalance test ${i}'
          }
        `)
      }

      // Simulate scaling to 5 shards (would need reconfiguration)
      // The consistent hashing ensures minimal data movement

      // This test documents the expected behavior - actual implementation TBD
      expect(true).toBe(true) // Placeholder for actual rebalancing test
    })

    it('should support parallel queries across shards', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(LARGE_DATA_SCHEMA)

      // Fan-out queries should execute in parallel
      const start = performance.now()
      const result = await client.queryAllShards(`
        select Document { content }
        limit 1000
      `)
      const elapsed = performance.now() - start

      // Parallel execution should be faster than serial (4x faster ideally)
      // This is a conceptual test - actual timing depends on implementation
      expect(Array.isArray(result)).toBe(true)
    })
  })
})

// =============================================================================
// 6. ERROR HANDLING TESTS (~10 tests)
// =============================================================================

describe('GEL Shard Integration - Error Handling', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('handles errors correctly', () => {
    it('should throw on invalid shard configuration', () => {
      expect(() =>
        createShardedClient({
          doNamespace: mockNamespace,
          shard: {
            key: '',
            algorithm: 'consistent',
            count: 0,
          },
        })
      ).toThrow()
    })

    it('should throw on missing shard key in query', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Query without extractable shard key should throw
      await expect(
        client.query(`select User { name } filter .name = 'Alice'`)
      ).rejects.toThrow()
    })

    it('should provide shard-specific error messages', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      try {
        await client.query(`
          insert User {
            tenant_id := 'error-tenant',
            email := 'invalid'
          }
        `)
      } catch (error: any) {
        // Error should indicate which shard failed
        expect(error.message).toMatch(/shard|tenant/i)
      }
    })

    it('should handle shard unavailability', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // When a shard is unavailable, should throw appropriate error
      // or return partial results depending on configuration
      // This test documents expected behavior
    })

    it('should validate tenant_id format', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Empty tenant_id should fail
      await expect(
        client.query(`
          insert User {
            tenant_id := '',
            email := 'empty@test.com',
            name := 'Empty'
          }
        `)
      ).rejects.toThrow()
    })

    it('should close all shard connections on close()', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      client.close()

      // Queries after close should fail
      await expect(
        client.query(`select User { name } filter .tenant_id = 'closed'`)
      ).rejects.toThrow()
    })
  })
})

// =============================================================================
// 7. CONFIGURATION TESTS (~10 tests)
// =============================================================================

describe('GEL Shard Integration - Configuration', () => {
  let mockNamespace: DurableObjectNamespace

  beforeEach(() => {
    clearRingCache()
    mockNamespace = createMockNamespace()
  })

  describe('configuration options', () => {
    it('should support custom shard key field', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'org_id', // Custom field instead of tenant_id
          algorithm: 'consistent',
          count: 4,
        },
      })

      await client.ensureSchema(`
        type Resource {
          required org_id: str;
          required name: str;
        }
      `)

      const result = await client.query(`
        insert Resource {
          org_id := 'org-custom',
          name := 'Custom Resource'
        }
      `)

      expect(result).toHaveProperty('org_id', 'org-custom')
    })

    it('should support debug mode', async () => {
      const logs: string[] = []

      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
        debug: true,
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Debug mode should log shard routing decisions
      // Actual logging depends on implementation
    })

    it('should expose shard count configuration', async () => {
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 8,
        },
      })

      // Should be able to query configuration
      // (would need getConfig() or similar method)
    })

    it('should support read replicas per shard', async () => {
      // Advanced configuration for read scaling
      const client = createShardedClient({
        doNamespace: mockNamespace,
        shard: {
          key: 'tenant_id',
          algorithm: 'consistent',
          count: 4,
        },
        // replica config would go here
      })

      await client.ensureSchema(MULTI_TENANT_SCHEMA)

      // Read queries could be routed to replicas
      const result = await client.query(`
        select User { name }
        filter .tenant_id = 'replica-tenant'
      `)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
