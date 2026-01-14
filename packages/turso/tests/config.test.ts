/**
 * @dotdo/turso - Extended Configuration Options Tests (RED Phase)
 *
 * Tests for integrating DO-specific extended config options with TursoClient:
 * - ShardConfig integration (tenant isolation, 10GB limit handling)
 * - ReplicaConfig integration (geo-distribution, read preferences)
 * - StreamConfig integration (pipeline analytics)
 * - TierConfig integration (hot/warm/cold storage)
 * - VectorConfig integration (pluggable vector tiers)
 *
 * These tests define the contract for how createClient() should handle
 * extended configuration options beyond the standard @libsql/client API.
 */
import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import type {
  // Core types from compat layer
  ShardConfig,
  ReplicaConfig,
  StreamConfig,
  TierConfig,
  VectorConfig,
  Jurisdiction,
  Region,
  City,
  ShardAlgorithm,
  ReadPreference,
  StreamSink,
  StorageTier,
  VectorEngineType,
  VectorRoutingStrategy,
} from '../../../compat/core/types'

// Import the client factory (will fail until implemented)
import { createClient, type TursoConfig, type TursoClient } from '../src'

// ============================================================================
// TYPE DEFINITIONS - Expected Config Interface
// ============================================================================

describe('@dotdo/turso configuration types', () => {
  it('should export TursoConfig type with standard libsql options', () => {
    // Standard @libsql/client options should be supported
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      authToken: 'token123',
    }
    expect(config.url).toBeDefined()
  })

  it('should extend TursoConfig with shard options', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      shard: {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      },
    }
    expectTypeOf(config.shard).toEqualTypeOf<ShardConfig | undefined>()
  })

  it('should extend TursoConfig with replica options', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      replica: {
        jurisdiction: 'eu',
        regions: ['eu-west-1', 'eu-central-1'],
        readFrom: 'nearest',
        writeThrough: true,
      },
    }
    expectTypeOf(config.replica).toEqualTypeOf<ReplicaConfig | undefined>()
  })

  it('should extend TursoConfig with stream options', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      stream: {
        pipeline: 'EVENTS_PIPELINE',
        sink: 'iceberg',
        batchSize: 1000,
      },
    }
    expectTypeOf(config.stream).toEqualTypeOf<StreamConfig | undefined>()
  })

  it('should extend TursoConfig with tier options', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      tier: {
        hot: 'sqlite',
        warm: 'r2',
        cold: 'archive',
        hotThreshold: '1GB',
        coldAfter: '90d',
      },
    }
    expectTypeOf(config.tier).toEqualTypeOf<TierConfig | undefined>()
  })

  it('should extend TursoConfig with vector options', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      vector: {
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          cold: { engine: 'clickhouse', dimensions: 768, index: 'usearch' },
        },
        routing: { strategy: 'cascade' },
      },
    }
    expectTypeOf(config.vector).toEqualTypeOf<VectorConfig | undefined>()
  })

  it('should support combined extended config', () => {
    const config: TursoConfig = {
      url: 'libsql://my-db.turso.io',
      authToken: 'token',
      shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
      replica: { jurisdiction: 'eu', readFrom: 'nearest' },
      stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      tier: { hot: 'sqlite', warm: 'r2' },
      vector: {
        tiers: { hot: { engine: 'libsql', dimensions: 128 } },
        routing: { strategy: 'cascade' },
      },
    }
    expect(config).toBeDefined()
  })
})

// ============================================================================
// SHARD CONFIG INTEGRATION
// ============================================================================

describe('Shard config integration', () => {
  describe('createClient with shard config', () => {
    it('should accept shard configuration', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: {
          key: 'tenant_id',
          count: 16,
          algorithm: 'consistent',
        },
      })
      expect(client).toBeDefined()
    })

    it('should expose shard configuration on client', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: {
          key: 'org_id',
          count: 8,
          algorithm: 'hash',
        },
      })
      expect(client.shardConfig).toEqual({
        key: 'org_id',
        count: 8,
        algorithm: 'hash',
      })
    })

    it('should default to single shard when not configured', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
      })
      expect(client.shardConfig).toBeUndefined()
      expect(client.isSharded).toBe(false)
    })

    it('should enable sharding mode when config provided', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'tenant_id', count: 4, algorithm: 'consistent' },
      })
      expect(client.isSharded).toBe(true)
    })
  })

  describe('shard key extraction', () => {
    it('should auto-detect shard key from WHERE clause', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
      })

      // Mock the internal routing
      const routeSpy = vi.spyOn(client, '_getShardForQuery' as any)

      await client.execute("SELECT * FROM users WHERE tenant_id = 'acme'")

      expect(routeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ shardKey: 'acme' })
      )
    })

    it('should route parameterized queries to correct shard', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
      })

      const routeSpy = vi.spyOn(client, '_getShardForQuery' as any)

      await client.execute({
        sql: 'SELECT * FROM users WHERE tenant_id = ?',
        args: ['acme'],
      })

      expect(routeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ shardKey: 'acme' })
      )
    })

    it('should fan out for queries without shard key', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'tenant_id', count: 4, algorithm: 'consistent' },
      })

      const fanOutSpy = vi.spyOn(client, '_queryAllShards' as any)

      await client.execute('SELECT COUNT(*) FROM users')

      expect(fanOutSpy).toHaveBeenCalled()
    })
  })

  describe('shard algorithm behavior', () => {
    it('should use consistent hashing for consistent algorithm', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
      })

      // Same key should always map to same shard
      const shard1 = client.getShardId('tenant-123')
      const shard2 = client.getShardId('tenant-123')
      expect(shard1).toBe(shard2)
    })

    it('should use range partitioning for range algorithm', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'created_year', count: 4, algorithm: 'range' },
      })

      // Range should partition by value
      const shard2020 = client.getShardId('2020')
      const shard2023 = client.getShardId('2023')
      expect(shard2020).not.toBe(shard2023)
    })

    it('should use simple hash for hash algorithm', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'id', count: 8, algorithm: 'hash' },
      })

      const shard = client.getShardId('key-1')
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(8)
    })
  })
})

// ============================================================================
// REPLICA CONFIG INTEGRATION
// ============================================================================

describe('Replica config integration', () => {
  describe('createClient with replica config', () => {
    it('should accept replica configuration', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'eu',
          readFrom: 'nearest',
        },
      })
      expect(client).toBeDefined()
    })

    it('should expose replica configuration on client', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'eu',
          regions: ['eu-west-1', 'eu-central-1'],
          cities: ['dub', 'fra'],
          readFrom: 'nearest',
          writeThrough: true,
        },
      })
      expect(client.replicaConfig?.jurisdiction).toBe('eu')
      expect(client.replicaConfig?.regions).toContain('eu-west-1')
      expect(client.replicaConfig?.readFrom).toBe('nearest')
    })

    it('should enable replication mode when config provided', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: { readFrom: 'nearest' },
      })
      expect(client.isReplicated).toBe(true)
    })
  })

  describe('read preference routing', () => {
    it('should route reads to nearest replica', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: { readFrom: 'nearest' },
      })

      const routeSpy = vi.spyOn(client, '_getReadReplica' as any)
      await client.execute('SELECT * FROM users')

      expect(routeSpy).toHaveBeenCalledWith('nearest')
    })

    it('should route reads to primary for strong consistency', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: { readFrom: 'primary' },
      })

      const routeSpy = vi.spyOn(client, '_getReadReplica' as any)
      await client.execute('SELECT * FROM users')

      expect(routeSpy).toHaveBeenCalledWith('primary')
    })

    it('should route reads to secondary replicas', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: { readFrom: 'secondary' },
      })

      const routeSpy = vi.spyOn(client, '_getReadReplica' as any)
      await client.execute('SELECT * FROM users')

      expect(routeSpy).toHaveBeenCalledWith('secondary')
    })
  })

  describe('write-through behavior', () => {
    it('should write through to all replicas when enabled', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          regions: ['us-east-1', 'eu-west-1'],
          readFrom: 'nearest',
          writeThrough: true,
        },
      })

      const writeSpy = vi.spyOn(client, '_writeToAllReplicas' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(writeSpy).toHaveBeenCalled()
    })

    it('should write only to primary when write-through disabled', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          regions: ['us-east-1', 'eu-west-1'],
          readFrom: 'nearest',
          writeThrough: false,
        },
      })

      const writeSpy = vi.spyOn(client, '_writeToPrimary' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(writeSpy).toHaveBeenCalled()
    })
  })

  describe('jurisdiction constraints', () => {
    it('should respect EU jurisdiction', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'eu',
          readFrom: 'nearest',
        },
      })

      const allowedRegions = client.getAllowedRegions()
      expect(allowedRegions).toContain('eu-west-1')
      expect(allowedRegions).toContain('eu-central-1')
      expect(allowedRegions).not.toContain('us-east-1')
    })

    it('should respect US jurisdiction', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'us',
          readFrom: 'nearest',
        },
      })

      const allowedRegions = client.getAllowedRegions()
      expect(allowedRegions).toContain('us-east-1')
      expect(allowedRegions).toContain('us-west-2')
      expect(allowedRegions).not.toContain('eu-west-1')
    })

    it('should respect FedRAMP jurisdiction', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'fedramp',
          readFrom: 'primary',
        },
      })

      const allowedRegions = client.getAllowedRegions()
      expect(allowedRegions).toContain('us-gov-west-1')
      expect(allowedRegions).toContain('us-gov-east-1')
      expect(allowedRegions).not.toContain('us-east-1')
    })
  })

  describe('city-level placement', () => {
    it('should support explicit city placement', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          cities: ['iad', 'lhr', 'sin'],
          readFrom: 'nearest',
        },
      })

      expect(client.replicaConfig?.cities).toEqual(['iad', 'lhr', 'sin'])
    })

    it('should route to specific colo for city placement', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        replica: {
          cities: ['ord'],
          readFrom: 'nearest',
        },
      })

      const coloSpy = vi.spyOn(client, '_routeToColo' as any)
      await client.execute('SELECT * FROM users')

      expect(coloSpy).toHaveBeenCalledWith('ord')
    })
  })
})

// ============================================================================
// STREAM CONFIG INTEGRATION
// ============================================================================

describe('Stream config integration', () => {
  describe('createClient with stream config', () => {
    it('should accept stream configuration', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'EVENTS_PIPELINE',
          sink: 'iceberg',
        },
      })
      expect(client).toBeDefined()
    })

    it('should expose stream configuration on client', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'ANALYTICS_PIPELINE',
          sink: 'parquet',
          batchSize: 500,
          flushInterval: 30000,
        },
      })
      expect(client.streamConfig?.pipeline).toBe('ANALYTICS_PIPELINE')
      expect(client.streamConfig?.sink).toBe('parquet')
      expect(client.streamConfig?.batchSize).toBe(500)
    })

    it('should enable streaming mode when config provided', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })
      expect(client.isStreaming).toBe(true)
    })
  })

  describe('write streaming', () => {
    it('should emit insert events to pipeline', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })

      const emitSpy = vi.spyOn(client, '_emitToStream' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(emitSpy).toHaveBeenCalledWith(
        'insert',
        expect.objectContaining({ table: 'users' })
      )
    })

    it('should emit update events to pipeline', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })

      const emitSpy = vi.spyOn(client, '_emitToStream' as any)
      await client.execute("UPDATE users SET name = 'Jane' WHERE id = 1")

      expect(emitSpy).toHaveBeenCalledWith(
        'update',
        expect.objectContaining({ table: 'users' })
      )
    })

    it('should emit delete events to pipeline', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })

      const emitSpy = vi.spyOn(client, '_emitToStream' as any)
      await client.execute('DELETE FROM users WHERE id = 1')

      expect(emitSpy).toHaveBeenCalledWith(
        'delete',
        expect.objectContaining({ table: 'users' })
      )
    })

    it('should not emit for read queries', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })

      const emitSpy = vi.spyOn(client, '_emitToStream' as any)
      await client.execute('SELECT * FROM users')

      expect(emitSpy).not.toHaveBeenCalled()
    })
  })

  describe('batching behavior', () => {
    it('should batch events before flushing', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'EVENTS',
          sink: 'iceberg',
          batchSize: 10,
        },
      })

      const flushSpy = vi.spyOn(client, '_flushStream' as any)

      // Insert 5 rows (less than batch size)
      for (let i = 0; i < 5; i++) {
        await client.execute(`INSERT INTO users (name) VALUES ('User ${i}')`)
      }

      expect(flushSpy).not.toHaveBeenCalled()
      expect(client.streamBufferSize).toBe(5)
    })

    it('should flush when batch size reached', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'EVENTS',
          sink: 'iceberg',
          batchSize: 5,
        },
      })

      const flushSpy = vi.spyOn(client, '_flushStream' as any)

      for (let i = 0; i < 5; i++) {
        await client.execute(`INSERT INTO users (name) VALUES ('User ${i}')`)
      }

      expect(flushSpy).toHaveBeenCalled()
    })

    it('should flush on interval', async () => {
      vi.useFakeTimers()

      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'EVENTS',
          sink: 'iceberg',
          batchSize: 1000,
          flushInterval: 5000,
        },
      })

      const flushSpy = vi.spyOn(client, '_flushStream' as any)

      await client.execute("INSERT INTO users (name) VALUES ('User')")
      await vi.advanceTimersByTime(5000)

      expect(flushSpy).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('sink formats', () => {
    it('should format events as Iceberg', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      })

      const formatSpy = vi.spyOn(client, '_formatForSink' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(formatSpy).toHaveBeenCalledWith('iceberg', expect.any(Object))
    })

    it('should format events as Parquet', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'parquet' },
      })

      const formatSpy = vi.spyOn(client, '_formatForSink' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(formatSpy).toHaveBeenCalledWith('parquet', expect.any(Object))
    })

    it('should format events as JSON', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'json' },
      })

      const formatSpy = vi.spyOn(client, '_formatForSink' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(formatSpy).toHaveBeenCalledWith('json', expect.any(Object))
    })
  })

  describe('transform function', () => {
    it('should apply transform before streaming', async () => {
      const transform = vi.fn((event) => ({
        ...event,
        transformed: true,
      }))

      const client = createClient({
        url: 'libsql://test.turso.io',
        stream: {
          pipeline: 'EVENTS',
          sink: 'iceberg',
          transform,
        },
      })

      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(transform).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// TIER CONFIG INTEGRATION
// ============================================================================

describe('Tier config integration', () => {
  describe('createClient with tier config', () => {
    it('should accept tier configuration', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: {
          hot: 'sqlite',
          warm: 'r2',
          cold: 'archive',
        },
      })
      expect(client).toBeDefined()
    })

    it('should expose tier configuration on client', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: {
          hot: 'sqlite',
          warm: 'r2',
          cold: 'archive',
          hotThreshold: '500MB',
          coldAfter: '30d',
        },
      })
      expect(client.tierConfig?.hot).toBe('sqlite')
      expect(client.tierConfig?.hotThreshold).toBe('500MB')
      expect(client.tierConfig?.coldAfter).toBe('30d')
    })

    it('should enable tiering mode when config provided', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })
      expect(client.isTiered).toBe(true)
    })
  })

  describe('hot tier operations', () => {
    it('should store recent data in SQLite (hot tier)', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })

      const tierSpy = vi.spyOn(client, '_getStorageTier' as any)
      await client.execute("INSERT INTO users (name) VALUES ('John')")

      expect(tierSpy).toHaveReturnedWith('sqlite')
    })

    it('should read recent data from SQLite', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })

      const tierSpy = vi.spyOn(client, '_readFromTier' as any)
      await client.execute('SELECT * FROM users WHERE id = 1')

      expect(tierSpy).toHaveBeenCalledWith('hot', expect.any(Object))
    })
  })

  describe('warm tier promotion', () => {
    it('should promote to warm tier when hot threshold exceeded', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: {
          hot: 'sqlite',
          warm: 'r2',
          hotThreshold: '1MB', // Very low for testing
        },
      })

      const promoteSpy = vi.spyOn(client, '_promoteToWarm' as any)
      await client.checkTierThresholds()

      // Should check if promotion needed
      expect(promoteSpy).toBeDefined()
    })

    it('should read from warm tier when data promoted', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })

      // Simulate data in warm tier
      vi.spyOn(client, '_dataLocation' as any).mockReturnValue('warm')

      const tierSpy = vi.spyOn(client, '_readFromTier' as any)
      await client.execute('SELECT * FROM archived_users WHERE id = 1')

      expect(tierSpy).toHaveBeenCalledWith('warm', expect.any(Object))
    })
  })

  describe('cold tier archival', () => {
    it('should archive to cold tier after threshold', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: {
          hot: 'sqlite',
          warm: 'r2',
          cold: 'archive',
          coldAfter: '30d',
        },
      })

      const archiveSpy = vi.spyOn(client, '_archiveToCold' as any)
      await client.runArchival()

      expect(archiveSpy).toBeDefined()
    })

    it('should fetch from cold tier for old data', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', cold: 'archive' },
      })

      // Simulate data in cold tier
      vi.spyOn(client, '_dataLocation' as any).mockReturnValue('cold')

      const tierSpy = vi.spyOn(client, '_readFromTier' as any)
      await client.execute('SELECT * FROM old_logs WHERE date < ?', ['2020-01-01'])

      expect(tierSpy).toHaveBeenCalledWith('cold', expect.any(Object))
    })
  })

  describe('tier utilities', () => {
    it('should report current storage size', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })

      const stats = await client.getTierStats()
      expect(stats).toHaveProperty('hotSize')
      expect(stats).toHaveProperty('warmSize')
    })

    it('should support manual promotion', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', warm: 'r2' },
      })

      await client.promoteTable('logs', 'warm')
      const location = await client.getTableTier('logs')
      expect(location).toBe('warm')
    })
  })
})

// ============================================================================
// VECTOR CONFIG INTEGRATION
// ============================================================================

describe('Vector config integration', () => {
  describe('createClient with vector config', () => {
    it('should accept vector configuration', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
          },
          routing: { strategy: 'cascade' },
        },
      })
      expect(client).toBeDefined()
    })

    it('should expose vector configuration on client', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            cold: { engine: 'clickhouse', dimensions: 768, index: 'usearch' },
          },
          routing: { strategy: 'cascade', fallback: true },
        },
      })
      expect(client.vectorConfig?.tiers.hot?.engine).toBe('libsql')
      expect(client.vectorConfig?.tiers.cold?.engine).toBe('clickhouse')
      expect(client.vectorConfig?.routing.strategy).toBe('cascade')
    })

    it('should enable vector mode when config provided', () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy: 'cascade' },
        },
      })
      expect(client.hasVectorSupport).toBe(true)
    })
  })

  describe('vector search routing', () => {
    it('should route vector search to hot tier first', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            cold: { engine: 'clickhouse', dimensions: 768 },
          },
          routing: { strategy: 'cascade' },
        },
      })

      const searchSpy = vi.spyOn(client, '_vectorSearch' as any)
      await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
      })

      expect(searchSpy).toHaveBeenCalledWith('hot', expect.any(Object))
    })

    it('should cascade to cold tier on insufficient results', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            cold: { engine: 'clickhouse', dimensions: 768 },
          },
          routing: { strategy: 'cascade', fallback: true },
        },
      })

      // Mock hot tier returning no results
      vi.spyOn(client, '_vectorSearch' as any)
        .mockResolvedValueOnce({ results: [] }) // Hot tier
        .mockResolvedValueOnce({ results: [{ id: 1, score: 0.9 }] }) // Cold tier

      const results = await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
      })

      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should query all tiers in parallel mode', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            warm: { engine: 'edgevec', dimensions: 384 },
            cold: { engine: 'clickhouse', dimensions: 768 },
          },
          routing: { strategy: 'parallel' },
        },
      })

      const searchSpy = vi.spyOn(client, '_vectorSearch' as any)
      await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
      })

      // Should call all tiers
      expect(searchSpy).toHaveBeenCalledTimes(3)
    })

    it('should use smart routing based on query', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            cold: { engine: 'clickhouse', dimensions: 768 },
          },
          routing: { strategy: 'smart' },
        },
      })

      const routeSpy = vi.spyOn(client, '_smartVectorRoute' as any)
      await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
        filter: { recent: true },
      })

      expect(routeSpy).toHaveBeenCalled()
    })
  })

  describe('vector engine specifics', () => {
    it('should use libsql F32_BLOB for libsql engine', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy: 'cascade' },
        },
      })

      const engineSpy = vi.spyOn(client, '_useLibsqlVector' as any)
      await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
      })

      expect(engineSpy).toHaveBeenCalled()
    })

    it('should use EdgeVec WASM for edgevec engine', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'edgevec', dimensions: 384 } },
          routing: { strategy: 'cascade' },
        },
      })

      const engineSpy = vi.spyOn(client, '_useEdgeVec' as any)
      await client.vectorSearch({
        embedding: new Float32Array(384),
        topK: 10,
      })

      expect(engineSpy).toHaveBeenCalled()
    })

    it('should use Vectorize binding for vectorize engine', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'vectorize', dimensions: 768 } },
          routing: { strategy: 'cascade' },
        },
      })

      const engineSpy = vi.spyOn(client, '_useVectorize' as any)
      await client.vectorSearch({
        embedding: new Float32Array(768),
        topK: 10,
      })

      expect(engineSpy).toHaveBeenCalled()
    })

    it('should use ClickHouse ANN for clickhouse engine', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            cold: {
              engine: 'clickhouse',
              dimensions: 768,
              index: 'usearch',
            },
          },
          routing: { strategy: 'cascade' },
        },
      })

      const engineSpy = vi.spyOn(client, '_useClickHouse' as any)
      await client.vectorSearch({
        embedding: new Float32Array(768),
        topK: 10,
      })

      expect(engineSpy).toHaveBeenCalled()
    })

    it('should use Iceberg for iceberg engine', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            cold: { engine: 'iceberg', dimensions: 768 },
          },
          routing: { strategy: 'cascade' },
        },
      })

      const engineSpy = vi.spyOn(client, '_useIceberg' as any)
      await client.vectorSearch({
        embedding: new Float32Array(768),
        topK: 10,
      })

      expect(engineSpy).toHaveBeenCalled()
    })
  })

  describe('vector dimension validation', () => {
    it('should reject mismatched dimensions', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy: 'cascade' },
        },
      })

      await expect(
        client.vectorSearch({
          embedding: new Float32Array(256), // Wrong dimensions
          topK: 10,
        })
      ).rejects.toThrow('Dimension mismatch')
    })

    it('should accept matching dimensions', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy: 'cascade' },
        },
      })

      await expect(
        client.vectorSearch({
          embedding: new Float32Array(128),
          topK: 10,
        })
      ).resolves.toBeDefined()
    })
  })

  describe('reranking', () => {
    it('should rerank results from parallel queries', async () => {
      const client = createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'libsql', dimensions: 128 },
            cold: { engine: 'clickhouse', dimensions: 768 },
          },
          routing: { strategy: 'parallel', rerank: true },
        },
      })

      const rerankSpy = vi.spyOn(client, '_rerankResults' as any)
      await client.vectorSearch({
        embedding: new Float32Array(128),
        topK: 10,
      })

      expect(rerankSpy).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// COMBINED CONFIG TESTS
// ============================================================================

describe('Combined config integration', () => {
  it('should support all config options together', () => {
    const client = createClient({
      url: 'libsql://test.turso.io',
      authToken: 'token',
      shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
      replica: { jurisdiction: 'eu', readFrom: 'nearest' },
      stream: { pipeline: 'EVENTS', sink: 'iceberg' },
      tier: { hot: 'sqlite', warm: 'r2', cold: 'archive' },
      vector: {
        tiers: { hot: { engine: 'libsql', dimensions: 128 } },
        routing: { strategy: 'cascade' },
      },
    })

    expect(client.isSharded).toBe(true)
    expect(client.isReplicated).toBe(true)
    expect(client.isStreaming).toBe(true)
    expect(client.isTiered).toBe(true)
    expect(client.hasVectorSupport).toBe(true)
  })

  it('should apply sharding before replication', async () => {
    const client = createClient({
      url: 'libsql://test.turso.io',
      shard: { key: 'tenant_id', count: 4, algorithm: 'consistent' },
      replica: { regions: ['us-east-1', 'eu-west-1'], readFrom: 'nearest' },
    })

    const shardSpy = vi.spyOn(client, '_routeToShard' as any)
    const replicaSpy = vi.spyOn(client, '_selectReplica' as any)

    await client.execute("SELECT * FROM users WHERE tenant_id = 'acme'")

    // Shard routing should happen first
    expect(shardSpy.mock.invocationCallOrder[0]).toBeLessThan(
      replicaSpy.mock.invocationCallOrder[0]
    )
  })

  it('should stream writes after tier storage', async () => {
    const client = createClient({
      url: 'libsql://test.turso.io',
      tier: { hot: 'sqlite', warm: 'r2' },
      stream: { pipeline: 'EVENTS', sink: 'iceberg' },
    })

    const tierSpy = vi.spyOn(client, '_storeInTier' as any)
    const streamSpy = vi.spyOn(client, '_emitToStream' as any)

    await client.execute("INSERT INTO users (name) VALUES ('John')")

    // Storage should happen before streaming
    expect(tierSpy.mock.invocationCallOrder[0]).toBeLessThan(
      streamSpy.mock.invocationCallOrder[0]
    )
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('Config validation errors', () => {
  it('should reject invalid shard count', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'id', count: 0, algorithm: 'consistent' },
      })
    ).toThrow('Invalid shard count')
  })

  it('should reject invalid shard algorithm', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        shard: { key: 'id', count: 4, algorithm: 'invalid' as ShardAlgorithm },
      })
    ).toThrow('Invalid shard algorithm')
  })

  it('should reject invalid jurisdiction', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        replica: {
          jurisdiction: 'invalid' as Jurisdiction,
          readFrom: 'nearest',
        },
      })
    ).toThrow('Invalid jurisdiction')
  })

  it('should reject invalid read preference', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        replica: { readFrom: 'invalid' as ReadPreference },
      })
    ).toThrow('Invalid read preference')
  })

  it('should reject invalid stream sink', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        stream: { pipeline: 'EVENTS', sink: 'invalid' as StreamSink },
      })
    ).toThrow('Invalid sink format')
  })

  it('should reject invalid storage tier', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'invalid' as StorageTier },
      })
    ).toThrow('Invalid storage tier')
  })

  it('should reject invalid hotThreshold format', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', hotThreshold: 'invalid' },
      })
    ).toThrow('Invalid threshold format')
  })

  it('should reject invalid coldAfter format', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        tier: { hot: 'sqlite', coldAfter: 'invalid' },
      })
    ).toThrow('Invalid duration format')
  })

  it('should reject invalid vector engine', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {
            hot: { engine: 'invalid' as VectorEngineType, dimensions: 128 },
          },
          routing: { strategy: 'cascade' },
        },
      })
    ).toThrow('Invalid vector engine')
  })

  it('should reject invalid vector routing strategy', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy: 'invalid' as VectorRoutingStrategy },
        },
      })
    ).toThrow('Invalid routing strategy')
  })

  it('should reject zero or negative dimensions', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: { hot: { engine: 'libsql', dimensions: 0 } },
          routing: { strategy: 'cascade' },
        },
      })
    ).toThrow('Invalid dimensions')
  })

  it('should reject empty vector tiers', () => {
    expect(() =>
      createClient({
        url: 'libsql://test.turso.io',
        vector: {
          tiers: {},
          routing: { strategy: 'cascade' },
        },
      })
    ).toThrow('At least one vector tier required')
  })
})

// ============================================================================
// PASSTHROUGH TO LIBSQL
// ============================================================================

describe('libsql passthrough mode', () => {
  it('should passthrough to real Turso when url provided without DO options', () => {
    const client = createClient({
      url: 'libsql://real-db.turso.io',
      authToken: 'real-token',
    })

    // Should be in passthrough mode
    expect(client.isPassthrough).toBe(true)
    expect(client.isSharded).toBe(false)
    expect(client.isReplicated).toBe(false)
  })

  it('should use DO-backed implementation when extended config provided', () => {
    const client = createClient({
      url: 'libsql://my-db.turso.io',
      shard: { key: 'tenant_id', count: 4, algorithm: 'consistent' },
    })

    expect(client.isPassthrough).toBe(false)
  })
})
