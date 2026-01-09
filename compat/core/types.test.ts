/**
 * Type contract tests for compat layer core types
 *
 * Tests verify type inference and runtime validation for:
 * - ShardConfig - DO sharding configuration
 * - ReplicaConfig - Geo-distribution and placement
 * - StreamConfig - Pipeline/analytics sink configuration
 * - TierConfig - Hot/warm/cold data tiering
 * - VectorConfig - Pluggable vector search tiers
 * - Region/City/Jurisdiction - Placement types
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  // Placement types
  Jurisdiction,
  Region,
  City,
  // Config types
  ShardConfig,
  ShardAlgorithm,
  ReplicaConfig,
  ReadPreference,
  StreamConfig,
  StreamSink,
  TierConfig,
  StorageTier,
  VectorConfig,
  VectorEngineType,
  VectorTierConfig,
  VectorRoutingStrategy,
  // Extended client config
  ExtendedConfig,
} from './types'
import {
  // Validators
  isValidJurisdiction,
  isValidRegion,
  isValidCity,
  isValidShardConfig,
  isValidReplicaConfig,
  isValidStreamConfig,
  isValidTierConfig,
  isValidVectorConfig,
  // Region mapping
  REGION_TO_COLO,
  JURISDICTION_REGIONS,
  // Defaults
  DEFAULT_SHARD_CONFIG,
  DEFAULT_REPLICA_CONFIG,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_TIER_CONFIG,
  DEFAULT_VECTOR_CONFIG,
} from './types'

// ============================================================================
// JURISDICTION TESTS
// ============================================================================

describe('Jurisdiction', () => {
  it('should accept valid jurisdictions', () => {
    expect(isValidJurisdiction('eu')).toBe(true)
    expect(isValidJurisdiction('us')).toBe(true)
    expect(isValidJurisdiction('fedramp')).toBe(true)
  })

  it('should reject invalid jurisdictions', () => {
    expect(isValidJurisdiction('invalid')).toBe(false)
    expect(isValidJurisdiction('')).toBe(false)
    expect(isValidJurisdiction(null)).toBe(false)
    expect(isValidJurisdiction(undefined)).toBe(false)
  })

  it('should have correct type inference', () => {
    const j: Jurisdiction = 'eu'
    expectTypeOf(j).toEqualTypeOf<'eu' | 'us' | 'fedramp'>()
  })

  it('should map jurisdictions to allowed regions', () => {
    expect(JURISDICTION_REGIONS.eu).toContain('eu-west-1')
    expect(JURISDICTION_REGIONS.eu).toContain('eu-central-1')
    expect(JURISDICTION_REGIONS.us).toContain('us-east-1')
    expect(JURISDICTION_REGIONS.us).toContain('us-west-2')
    expect(JURISDICTION_REGIONS.fedramp).toContain('us-gov-west-1')
  })
})

// ============================================================================
// REGION TESTS
// ============================================================================

describe('Region', () => {
  it('should accept valid AWS-style regions', () => {
    expect(isValidRegion('us-east-1')).toBe(true)
    expect(isValidRegion('us-west-2')).toBe(true)
    expect(isValidRegion('eu-west-1')).toBe(true)
    expect(isValidRegion('eu-central-1')).toBe(true)
    expect(isValidRegion('ap-northeast-1')).toBe(true)
    expect(isValidRegion('ap-southeast-1')).toBe(true)
  })

  it('should reject Cloudflare hint names', () => {
    // We use AWS-style names, not Cloudflare hints
    expect(isValidRegion('wnam')).toBe(false)
    expect(isValidRegion('enam')).toBe(false)
    expect(isValidRegion('weur')).toBe(false)
  })

  it('should reject invalid regions', () => {
    expect(isValidRegion('invalid')).toBe(false)
    expect(isValidRegion('')).toBe(false)
    expect(isValidRegion('us-east')).toBe(false) // Missing number
  })

  it('should map regions to colo codes', () => {
    expect(REGION_TO_COLO['us-east-1']).toBe('iad')
    expect(REGION_TO_COLO['us-west-2']).toBe('sea')
    expect(REGION_TO_COLO['eu-west-1']).toBe('dub')
    expect(REGION_TO_COLO['eu-west-2']).toBe('lhr')
    expect(REGION_TO_COLO['ap-northeast-1']).toBe('nrt')
    expect(REGION_TO_COLO['ap-southeast-1']).toBe('sin')
  })
})

// ============================================================================
// CITY TESTS
// ============================================================================

describe('City', () => {
  it('should accept valid IATA colo codes', () => {
    expect(isValidCity('iad')).toBe(true) // Washington DC
    expect(isValidCity('lhr')).toBe(true) // London
    expect(isValidCity('nrt')).toBe(true) // Tokyo
    expect(isValidCity('sin')).toBe(true) // Singapore
    expect(isValidCity('fra')).toBe(true) // Frankfurt
    expect(isValidCity('syd')).toBe(true) // Sydney
  })

  it('should reject invalid city codes', () => {
    expect(isValidCity('invalid')).toBe(false)
    expect(isValidCity('')).toBe(false)
    expect(isValidCity('abcd')).toBe(false) // 4 chars
    expect(isValidCity('ab')).toBe(false) // 2 chars
  })

  it('should be usable for colo.do placement', () => {
    // Cities are 3-letter IATA codes for use with colo.do
    const city: City = 'iad'
    expect(city.length).toBe(3)
  })
})

// ============================================================================
// SHARD CONFIG TESTS
// ============================================================================

describe('ShardConfig', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_SHARD_CONFIG).toEqual({
      key: 'id',
      count: 1,
      algorithm: 'consistent',
    })
  })

  it('should accept valid shard configs', () => {
    const config: ShardConfig = {
      key: 'tenant_id',
      count: 16,
      algorithm: 'consistent',
    }
    expect(isValidShardConfig(config)).toBe(true)
  })

  it('should accept all algorithm types', () => {
    expect(isValidShardConfig({ key: 'id', count: 4, algorithm: 'consistent' })).toBe(true)
    expect(isValidShardConfig({ key: 'id', count: 4, algorithm: 'range' })).toBe(true)
    expect(isValidShardConfig({ key: 'id', count: 4, algorithm: 'hash' })).toBe(true)
  })

  it('should reject invalid shard counts', () => {
    expect(isValidShardConfig({ key: 'id', count: 0, algorithm: 'consistent' })).toBe(false)
    expect(isValidShardConfig({ key: 'id', count: -1, algorithm: 'consistent' })).toBe(false)
    expect(isValidShardConfig({ key: 'id', count: 1.5, algorithm: 'consistent' })).toBe(false)
  })

  it('should reject empty shard keys', () => {
    expect(isValidShardConfig({ key: '', count: 4, algorithm: 'consistent' })).toBe(false)
  })

  it('should reject invalid algorithms', () => {
    expect(isValidShardConfig({ key: 'id', count: 4, algorithm: 'invalid' as ShardAlgorithm })).toBe(false)
  })

  it('should have correct type inference', () => {
    const alg: ShardAlgorithm = 'consistent'
    expectTypeOf(alg).toEqualTypeOf<'consistent' | 'range' | 'hash'>()
  })
})

// ============================================================================
// REPLICA CONFIG TESTS
// ============================================================================

describe('ReplicaConfig', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_REPLICA_CONFIG).toEqual({
      readFrom: 'nearest',
      writeThrough: true,
    })
  })

  it('should accept valid replica configs', () => {
    const config: ReplicaConfig = {
      jurisdiction: 'eu',
      regions: ['eu-west-1', 'eu-central-1'],
      cities: ['dub', 'fra'],
      readFrom: 'nearest',
      writeThrough: true,
    }
    expect(isValidReplicaConfig(config)).toBe(true)
  })

  it('should accept minimal replica config', () => {
    const config: ReplicaConfig = {
      readFrom: 'primary',
    }
    expect(isValidReplicaConfig(config)).toBe(true)
  })

  it('should accept all read preferences', () => {
    expect(isValidReplicaConfig({ readFrom: 'nearest' })).toBe(true)
    expect(isValidReplicaConfig({ readFrom: 'primary' })).toBe(true)
    expect(isValidReplicaConfig({ readFrom: 'secondary' })).toBe(true)
  })

  it('should validate jurisdiction when provided', () => {
    expect(isValidReplicaConfig({ jurisdiction: 'eu', readFrom: 'nearest' })).toBe(true)
    expect(isValidReplicaConfig({ jurisdiction: 'invalid' as Jurisdiction, readFrom: 'nearest' })).toBe(false)
  })

  it('should validate regions when provided', () => {
    expect(isValidReplicaConfig({ regions: ['us-east-1'], readFrom: 'nearest' })).toBe(true)
    expect(isValidReplicaConfig({ regions: ['invalid'], readFrom: 'nearest' })).toBe(false)
  })

  it('should validate cities when provided', () => {
    expect(isValidReplicaConfig({ cities: ['iad', 'lhr'], readFrom: 'nearest' })).toBe(true)
    expect(isValidReplicaConfig({ cities: ['invalid'], readFrom: 'nearest' })).toBe(false)
  })

  it('should have correct type inference', () => {
    const pref: ReadPreference = 'nearest'
    expectTypeOf(pref).toEqualTypeOf<'nearest' | 'primary' | 'secondary'>()
  })
})

// ============================================================================
// STREAM CONFIG TESTS
// ============================================================================

describe('StreamConfig', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_STREAM_CONFIG).toEqual({
      sink: 'iceberg',
      batchSize: 1000,
      flushInterval: 60000,
    })
  })

  it('should accept valid stream configs', () => {
    const config: StreamConfig = {
      pipeline: 'EVENTS_PIPELINE',
      sink: 'iceberg',
      transform: (event) => event,
      batchSize: 500,
      flushInterval: 30000,
    }
    expect(isValidStreamConfig(config)).toBe(true)
  })

  it('should accept all sink types', () => {
    expect(isValidStreamConfig({ sink: 'iceberg' })).toBe(true)
    expect(isValidStreamConfig({ sink: 'parquet' })).toBe(true)
    expect(isValidStreamConfig({ sink: 'json' })).toBe(true)
  })

  it('should validate pipeline binding name', () => {
    expect(isValidStreamConfig({ pipeline: 'EVENTS', sink: 'iceberg' })).toBe(true)
    expect(isValidStreamConfig({ pipeline: '', sink: 'iceberg' })).toBe(false)
  })

  it('should validate batch size', () => {
    expect(isValidStreamConfig({ sink: 'iceberg', batchSize: 100 })).toBe(true)
    expect(isValidStreamConfig({ sink: 'iceberg', batchSize: 0 })).toBe(false)
    expect(isValidStreamConfig({ sink: 'iceberg', batchSize: -1 })).toBe(false)
  })

  it('should validate flush interval', () => {
    expect(isValidStreamConfig({ sink: 'iceberg', flushInterval: 1000 })).toBe(true)
    expect(isValidStreamConfig({ sink: 'iceberg', flushInterval: 0 })).toBe(false)
    expect(isValidStreamConfig({ sink: 'iceberg', flushInterval: -1 })).toBe(false)
  })

  it('should have correct type inference', () => {
    const sink: StreamSink = 'iceberg'
    expectTypeOf(sink).toEqualTypeOf<'iceberg' | 'parquet' | 'json'>()
  })
})

// ============================================================================
// TIER CONFIG TESTS
// ============================================================================

describe('TierConfig', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_TIER_CONFIG).toEqual({
      hot: 'sqlite',
      warm: 'r2',
      cold: 'archive',
      hotThreshold: '1GB',
      coldAfter: '90d',
    })
  })

  it('should accept valid tier configs', () => {
    const config: TierConfig = {
      hot: 'sqlite',
      warm: 'r2',
      cold: 'archive',
      hotThreshold: '500MB',
      coldAfter: '30d',
    }
    expect(isValidTierConfig(config)).toBe(true)
  })

  it('should accept all storage tier types', () => {
    const tiers: StorageTier[] = ['sqlite', 'r2', 'archive']
    tiers.forEach((tier) => {
      expect(isValidTierConfig({ hot: tier })).toBe(true)
    })
  })

  it('should validate threshold format', () => {
    expect(isValidTierConfig({ hotThreshold: '1GB' })).toBe(true)
    expect(isValidTierConfig({ hotThreshold: '500MB' })).toBe(true)
    expect(isValidTierConfig({ hotThreshold: '100KB' })).toBe(true)
    expect(isValidTierConfig({ hotThreshold: 'invalid' })).toBe(false)
    expect(isValidTierConfig({ hotThreshold: '1' })).toBe(false)
  })

  it('should validate coldAfter duration format', () => {
    expect(isValidTierConfig({ coldAfter: '30d' })).toBe(true)
    expect(isValidTierConfig({ coldAfter: '24h' })).toBe(true)
    expect(isValidTierConfig({ coldAfter: '60m' })).toBe(true)
    expect(isValidTierConfig({ coldAfter: 'invalid' })).toBe(false)
  })

  it('should have correct type inference', () => {
    const tier: StorageTier = 'sqlite'
    expectTypeOf(tier).toEqualTypeOf<'sqlite' | 'r2' | 'archive'>()
  })
})

// ============================================================================
// VECTOR CONFIG TESTS
// ============================================================================

describe('VectorConfig', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_VECTOR_CONFIG).toEqual({
      tiers: {
        hot: { engine: 'libsql', dimensions: 128 },
      },
      routing: { strategy: 'cascade' },
    })
  })

  it('should accept valid vector configs', () => {
    const config: VectorConfig = {
      tiers: {
        hot: { engine: 'libsql', dimensions: 128 },
        warm: { engine: 'edgevec', dimensions: 384 },
        cold: { engine: 'clickhouse', dimensions: 768, index: 'usearch' },
      },
      routing: { strategy: 'cascade', fallback: true },
    }
    expect(isValidVectorConfig(config)).toBe(true)
  })

  it('should accept all engine types', () => {
    const engines: VectorEngineType[] = ['libsql', 'edgevec', 'vectorize', 'clickhouse', 'iceberg']
    engines.forEach((engine) => {
      expect(
        isValidVectorConfig({
          tiers: { hot: { engine, dimensions: 128 } },
          routing: { strategy: 'cascade' },
        })
      ).toBe(true)
    })
  })

  it('should accept all routing strategies', () => {
    const strategies: VectorRoutingStrategy[] = ['cascade', 'parallel', 'smart']
    strategies.forEach((strategy) => {
      expect(
        isValidVectorConfig({
          tiers: { hot: { engine: 'libsql', dimensions: 128 } },
          routing: { strategy },
        })
      ).toBe(true)
    })
  })

  it('should validate dimensions', () => {
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'libsql', dimensions: 128 } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(true)
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'libsql', dimensions: 0 } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(false)
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'libsql', dimensions: -1 } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(false)
  })

  it('should validate ClickHouse index types', () => {
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'clickhouse', dimensions: 768, index: 'usearch' } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(true)
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'clickhouse', dimensions: 768, index: 'annoy' } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(true)
    expect(
      isValidVectorConfig({
        tiers: { hot: { engine: 'clickhouse', dimensions: 768, index: 'hnsw' } },
        routing: { strategy: 'cascade' },
      })
    ).toBe(true)
  })

  it('should require at least one tier', () => {
    expect(
      isValidVectorConfig({
        tiers: {},
        routing: { strategy: 'cascade' },
      })
    ).toBe(false)
  })

  it('should have correct type inference', () => {
    const engine: VectorEngineType = 'libsql'
    expectTypeOf(engine).toEqualTypeOf<'libsql' | 'edgevec' | 'vectorize' | 'clickhouse' | 'iceberg'>()

    const strategy: VectorRoutingStrategy = 'cascade'
    expectTypeOf(strategy).toEqualTypeOf<'cascade' | 'parallel' | 'smart'>()
  })
})

// ============================================================================
// EXTENDED CONFIG TESTS
// ============================================================================

describe('ExtendedConfig', () => {
  it('should compose all config types', () => {
    const config: ExtendedConfig = {
      shard: {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      },
      replica: {
        jurisdiction: 'eu',
        regions: ['eu-west-1', 'eu-central-1'],
        readFrom: 'nearest',
        writeThrough: true,
      },
      stream: {
        pipeline: 'EVENTS_PIPELINE',
        sink: 'iceberg',
      },
      tier: {
        hot: 'sqlite',
        warm: 'r2',
        cold: 'archive',
        hotThreshold: '1GB',
        coldAfter: '90d',
      },
      vector: {
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          cold: { engine: 'clickhouse', dimensions: 768, index: 'usearch' },
        },
        routing: { strategy: 'cascade' },
      },
    }

    // All fields should be optional
    const minimalConfig: ExtendedConfig = {}
    expect(minimalConfig).toBeDefined()

    // Should be able to use individual configs
    const shardOnly: ExtendedConfig = {
      shard: { key: 'id', count: 4, algorithm: 'hash' },
    }
    expect(shardOnly.shard).toBeDefined()
  })

  it('should allow partial configs', () => {
    const partial: ExtendedConfig = {
      replica: {
        readFrom: 'nearest',
      },
      vector: {
        tiers: { hot: { engine: 'libsql', dimensions: 128 } },
        routing: { strategy: 'smart' },
      },
    }
    expect(partial.replica?.readFrom).toBe('nearest')
    expect(partial.vector?.routing.strategy).toBe('smart')
  })
})
