/**
 * Tests for $.shard Context API
 *
 * TDD tests for the shard namespace providing DO-level sharding capabilities.
 *
 * API Design:
 * - $.shard(namespace, config?) - Create or access ShardManager for a namespace
 * - $.shard(namespace).getShardStub(key) - Get DO stub for a specific key
 * - $.shard(namespace).getShardId(key) - Get shard index for a key
 * - $.shard(namespace).queryAll(path, init?) - Fan out query to all shards
 * - $.shard(namespace).getAllShardStubs() - Get all shard stubs
 *
 * @module workflows/context/tests/shard
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  createMockContext,
  type ShardContext,
  type ShardContextInstance,
  consistentHash,
  rangeHash,
  simpleHash,
  extractShardKey,
} from '../shard'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('$.shard Context API', () => {
  let ctx: ShardContext

  beforeEach(() => {
    ctx = createMockContext()
  })

  // ============================================================================
  // 1. NAMESPACE STRUCTURE
  // ============================================================================

  describe('Namespace Structure', () => {
    it('should have $.shard function on context', () => {
      expect(ctx.shard).toBeDefined()
      expect(typeof ctx.shard).toBe('function')
    })

    it('should expose internal storage for testing', () => {
      expect(ctx._storage).toBeDefined()
      expect(ctx._storage.managers).toBeDefined()
      expect(ctx._storage.configs).toBeDefined()
      expect(ctx._storage.mockBindings).toBeDefined()
    })

    it('should have _registerMockNamespace function', () => {
      expect(ctx._registerMockNamespace).toBeDefined()
      expect(typeof ctx._registerMockNamespace).toBe('function')
    })
  })

  // ============================================================================
  // 2. SHARD INSTANCE CREATION
  // ============================================================================

  describe('Shard Instance Creation', () => {
    it('should create shard instance for namespace', () => {
      const shard = ctx.shard('tenants')
      expect(shard).toBeDefined()
    })

    it('should return ShardContextInstance with all methods', () => {
      const shard = ctx.shard('tenants')

      expect(typeof shard.manager).toBe('function')
      expect(typeof shard.getShardId).toBe('function')
      expect(typeof shard.getShardStub).toBe('function')
      expect(typeof shard.getShardStubForSql).toBe('function')
      expect(typeof shard.queryAll).toBe('function')
      expect(typeof shard.getAllShardStubs).toBe('function')
      expect(typeof shard.config).toBe('function')
      expect(typeof shard.shardCount).toBe('function')
      expect(typeof shard.shardKey).toBe('function')
    })

    it('should use default config when none provided', () => {
      const shard = ctx.shard('tenants')
      const config = shard.config()

      expect(config.key).toBe('id')
      expect(config.count).toBe(1)
      expect(config.algorithm).toBe('consistent')
    })

    it('should accept custom config', () => {
      const shard = ctx.shard('tenants', {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      })
      const config = shard.config()

      expect(config.key).toBe('tenant_id')
      expect(config.count).toBe(16)
      expect(config.algorithm).toBe('consistent')
    })

    it('should reuse manager for same namespace', () => {
      const shard1 = ctx.shard('tenants', { count: 4 })
      const shard2 = ctx.shard('tenants')

      expect(shard1.manager()).toBe(shard2.manager())
      expect(ctx._storage.managers.size).toBe(1)
    })

    it('should create separate managers for different namespaces', () => {
      const tenants = ctx.shard('tenants', { count: 4 })
      const users = ctx.shard('users', { count: 8 })

      expect(tenants.manager()).not.toBe(users.manager())
      expect(ctx._storage.managers.size).toBe(2)
    })
  })

  // ============================================================================
  // 3. SHARD ID CALCULATION
  // ============================================================================

  describe('Shard ID Calculation', () => {
    it('should return shard ID for key', () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const id = shard.getShardId('tenant-123')

      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThanOrEqual(0)
      expect(id).toBeLessThan(4)
    })

    it('should return consistent shard ID for same key', () => {
      const shard = ctx.shard('tenants', { count: 16 })
      const id1 = shard.getShardId('tenant-abc')
      const id2 = shard.getShardId('tenant-abc')

      expect(id1).toBe(id2)
    })

    it('should distribute keys across shards', () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const shardCounts = new Map<number, number>()

      for (let i = 0; i < 100; i++) {
        const id = shard.getShardId(`tenant-${i}`)
        shardCounts.set(id, (shardCounts.get(id) ?? 0) + 1)
      }

      // Should use multiple shards
      expect(shardCounts.size).toBeGreaterThan(1)
    })

    it('should respect shard count configuration', () => {
      const shard = ctx.shard('tenants', { count: 8 })

      for (let i = 0; i < 100; i++) {
        const id = shard.getShardId(`tenant-${i}`)
        expect(id).toBeGreaterThanOrEqual(0)
        expect(id).toBeLessThan(8)
      }
    })
  })

  // ============================================================================
  // 4. SHARD STUB RETRIEVAL
  // ============================================================================

  describe('Shard Stub Retrieval', () => {
    it('should get shard stub for key', async () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const stub = await shard.getShardStub('tenant-123')

      expect(stub).toBeDefined()
      expect(stub.id).toBeDefined()
    })

    it('should return consistent stub for same key', async () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const stub1 = await shard.getShardStub('tenant-abc')
      const stub2 = await shard.getShardStub('tenant-abc')

      expect(stub1.id.toString()).toBe(stub2.id.toString())
    })

    it('should get all shard stubs', () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const stubs = shard.getAllShardStubs()

      expect(stubs).toHaveLength(4)
      stubs.forEach((stub) => {
        expect(stub).toBeDefined()
        expect(stub.id).toBeDefined()
      })
    })
  })

  // ============================================================================
  // 5. SQL SHARD KEY EXTRACTION
  // ============================================================================

  describe('SQL Shard Key Extraction', () => {
    it('should get stub for SQL with WHERE clause', async () => {
      const shard = ctx.shard('tenants', { key: 'tenant_id', count: 4 })
      const stub = await shard.getShardStubForSql(
        "SELECT * FROM data WHERE tenant_id = 'tenant-123'"
      )

      expect(stub).toBeDefined()
    })

    it('should return undefined when shard key not found', async () => {
      const shard = ctx.shard('tenants', { key: 'tenant_id', count: 4 })
      const stub = await shard.getShardStubForSql(
        'SELECT * FROM data WHERE user_id = 123'
      )

      expect(stub).toBeUndefined()
    })

    it('should handle parameterized queries', async () => {
      const shard = ctx.shard('tenants', { key: 'tenant_id', count: 4 })
      const stub = await shard.getShardStubForSql(
        'SELECT * FROM data WHERE tenant_id = ?',
        ['tenant-456']
      )

      expect(stub).toBeDefined()
    })
  })

  // ============================================================================
  // 6. FAN OUT QUERIES
  // ============================================================================

  describe('Fan Out Queries', () => {
    it('should query all shards', async () => {
      const shard = ctx.shard('tenants', { count: 4 })
      const results = await shard.queryAll('/query')

      expect(results).toHaveLength(4)
      results.forEach((result) => {
        expect(result.shard).toBeGreaterThanOrEqual(0)
        expect(result.shard).toBeLessThan(4)
      })
    })

    it('should include data in results', async () => {
      const shard = ctx.shard('tenants', { count: 2 })
      const results = await shard.queryAll<{ mock: boolean }>('/query')

      results.forEach((result) => {
        expect(result.data).toBeDefined()
        expect(result.data?.mock).toBe(true)
      })
    })
  })

  // ============================================================================
  // 7. CONFIGURATION ACCESS
  // ============================================================================

  describe('Configuration Access', () => {
    it('should return shard count', () => {
      const shard = ctx.shard('tenants', { count: 16 })
      expect(shard.shardCount()).toBe(16)
    })

    it('should return shard key', () => {
      const shard = ctx.shard('tenants', { key: 'tenant_id' })
      expect(shard.shardKey()).toBe('tenant_id')
    })

    it('should return full config', () => {
      const shard = ctx.shard('tenants', {
        key: 'org_id',
        count: 8,
        algorithm: 'range',
      })
      const config = shard.config()

      expect(config.key).toBe('org_id')
      expect(config.count).toBe(8)
      expect(config.algorithm).toBe('range')
    })
  })

  // ============================================================================
  // 8. HASHING ALGORITHMS
  // ============================================================================

  describe('Hashing Algorithms', () => {
    describe('consistentHash', () => {
      it('should return index within count', () => {
        const index = consistentHash('key', 16)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(16)
      })

      it('should be deterministic', () => {
        const idx1 = consistentHash('same-key', 8)
        const idx2 = consistentHash('same-key', 8)
        expect(idx1).toBe(idx2)
      })
    })

    describe('rangeHash', () => {
      it('should return index within count', () => {
        const index = rangeHash('apple', 4)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(4)
      })

      it('should handle numeric keys', () => {
        const index = rangeHash(500, 10, 0, 1000)
        expect(index).toBe(5)
      })
    })

    describe('simpleHash', () => {
      it('should return index within count', () => {
        const index = simpleHash('key', 8)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(8)
      })

      it('should be deterministic', () => {
        const idx1 = simpleHash('test', 16)
        const idx2 = simpleHash('test', 16)
        expect(idx1).toBe(idx2)
      })
    })
  })

  // ============================================================================
  // 9. EXTRACT SHARD KEY
  // ============================================================================

  describe('extractShardKey', () => {
    it('should extract from WHERE clause with string', () => {
      const key = extractShardKey(
        "SELECT * FROM t WHERE tenant_id = 'abc'",
        'tenant_id'
      )
      expect(key).toBe('abc')
    })

    it('should extract from WHERE clause with number', () => {
      const key = extractShardKey(
        'SELECT * FROM t WHERE id = 123',
        'id'
      )
      expect(key).toBe('123')
    })

    it('should extract from parameterized query', () => {
      const key = extractShardKey(
        'SELECT * FROM t WHERE tenant_id = ?',
        'tenant_id',
        ['value-123']
      )
      expect(key).toBe('value-123')
    })

    it('should return undefined for IN clause', () => {
      const key = extractShardKey(
        "SELECT * FROM t WHERE tenant_id IN ('a', 'b')",
        'tenant_id'
      )
      expect(key).toBeUndefined()
    })
  })
})
