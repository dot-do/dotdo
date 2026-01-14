/**
 * Phase 3 Test Fixtures - Sharding Tests
 *
 * Provides test data and fixtures for DO sharding operations:
 * - Large datasets for sharding distribution tests
 * - Pre-sharded shard registries
 * - Sharded data partitions
 * - Range boundaries for range-based sharding
 * - Conflicting things for merge/unshard tests
 *
 * @see types/Lifecycle.ts for ShardStrategy, ShardOptions, ShardResult
 * @see db/objects.ts for objects table shard schema
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Test thing fixture with sharding-relevant data
 */
export interface TestThing {
  id: string
  type: number
  branch: string | null
  name: string
  data: {
    value: number
    category: string
    region: string
    priority?: number
  }
  deleted: boolean
  visibility: string
}

/**
 * Shard registry entry
 */
export interface ShardRegistryEntry {
  ns: string
  id: string
  class: string
  relation: 'shard'
  shardKey: string
  shardIndex: number
  createdAt: Date
}

/**
 * Range boundary for range-based sharding
 */
export interface RangeBoundary {
  start: string
  end: string
  shardIndex: number
}

// ============================================================================
// FIXTURE DATA
// ============================================================================

/**
 * Generate large dataset for sharding tests (1000 things)
 *
 * Each thing has:
 * - Unique ID in format 'thing-0000' to 'thing-0999'
 * - Category cycling through A, B, C, D
 * - Region cycling through us-east, us-west, eu-west
 * - Value equal to index for predictable testing
 */
export function createLargeDataset(count: number = 1000): TestThing[] {
  const categories = ['A', 'B', 'C', 'D']
  const regions = ['us-east', 'us-west', 'eu-west']

  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i.toString().padStart(4, '0')}`,
    type: 1,
    branch: null,
    name: `Thing ${i}`,
    data: {
      value: i,
      category: categories[i % categories.length]!,
      region: regions[i % regions.length]!,
      priority: i % 10,
    },
    deleted: false,
    visibility: 'user',
  }))
}

/**
 * Pre-configured 4-shard registry for testing coordinator behavior
 */
export function createShardRegistry(
  baseNs: string = 'https://test.do',
  shardKey: string = 'id',
  count: number = 4
): ShardRegistryEntry[] {
  const now = new Date()

  return Array.from({ length: count }, (_, i) => ({
    ns: `${baseNs}/shard/${i}`,
    id: `shard-${i}`,
    class: 'DO',
    relation: 'shard' as const,
    shardKey,
    shardIndex: i,
    createdAt: now,
  }))
}

/**
 * Pre-distributed data partitions for each shard
 * Uses round-robin distribution based on hash of ID
 *
 * For hash-based sharding with 4 shards:
 * - shard0: thing-0000, thing-0004, thing-0008, ...
 * - shard1: thing-0001, thing-0005, thing-0009, ...
 * - shard2: thing-0002, thing-0006, thing-0010, ...
 * - shard3: thing-0003, thing-0007, thing-0011, ...
 */
export function createShardedPartitions(
  totalCount: number = 1000,
  shardCount: number = 4
): Map<number, TestThing[]> {
  const partitions = new Map<number, TestThing[]>()
  const fullDataset = createLargeDataset(totalCount)

  // Initialize empty arrays for each shard
  for (let i = 0; i < shardCount; i++) {
    partitions.set(i, [])
  }

  // Distribute things by hash-based round-robin
  fullDataset.forEach((thing, index) => {
    const shardIndex = index % shardCount
    partitions.get(shardIndex)!.push(thing)
  })

  return partitions
}

/**
 * Range boundaries for range-based sharding
 * Divides the ID space into equal ranges
 */
export function createRangeBoundaries(
  totalCount: number = 1000,
  shardCount: number = 4
): RangeBoundary[] {
  const itemsPerShard = Math.ceil(totalCount / shardCount)

  return Array.from({ length: shardCount }, (_, i) => {
    const start = i * itemsPerShard
    const end = Math.min((i + 1) * itemsPerShard - 1, totalCount - 1)

    return {
      start: `thing-${start.toString().padStart(4, '0')}`,
      end: `thing-${end.toString().padStart(4, '0')}`,
      shardIndex: i,
    }
  })
}

/**
 * Create things with the same ID for conflict testing during unshard
 * Each shard will have a version with different data
 */
export function createConflictingThings(
  conflictId: string = 'conflict-thing',
  shardCount: number = 4
): Map<number, TestThing> {
  const conflicting = new Map<number, TestThing>()

  for (let i = 0; i < shardCount; i++) {
    conflicting.set(i, {
      id: conflictId,
      type: 1,
      branch: null,
      name: `Conflict Thing Shard ${i}`,
      data: {
        value: i * 100,
        category: ['A', 'B', 'C', 'D'][i]!,
        region: 'conflict-region',
        priority: i,
      },
      deleted: false,
      visibility: 'user',
    })
  }

  return conflicting
}

// ============================================================================
// PRE-BUILT FIXTURES
// ============================================================================

/**
 * Standard Phase 3 fixtures object
 * Use these for consistent test setup across all Phase 3 tests
 */
export const PHASE3_FIXTURES = {
  /** Large dataset for sharding tests (1000 things) */
  largeDataset: createLargeDataset(1000),

  /** Medium dataset for faster tests (100 things) */
  mediumDataset: createLargeDataset(100),

  /** Small dataset for unit tests (10 things) */
  smallDataset: createLargeDataset(10),

  /** Pre-sharded shard registry (4 shards) */
  shardRegistry: createShardRegistry('https://test.do', 'id', 4),

  /** Sharded partitions (4 shards, 1000 things) */
  shardedPartitions: createShardedPartitions(1000, 4),

  /** Range boundaries for range sharding (4 shards) */
  rangeBoundaries: createRangeBoundaries(1000, 4),

  /** Conflicting things for unshard tests */
  conflictingThings: createConflictingThings('conflict-thing', 4),
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate expected shard index for a thing ID using hash strategy
 * Uses simple hash function for deterministic routing
 */
export function calculateHashShardIndex(
  thingId: string,
  shardCount: number
): number {
  // Simple hash: sum of char codes modulo shard count
  let hash = 0
  for (let i = 0; i < thingId.length; i++) {
    hash = ((hash << 5) - hash + thingId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % shardCount
}

/**
 * Calculate expected shard index for a thing ID using range strategy
 */
export function calculateRangeShardIndex(
  thingId: string,
  boundaries: RangeBoundary[]
): number {
  for (const boundary of boundaries) {
    if (thingId >= boundary.start && thingId <= boundary.end) {
      return boundary.shardIndex
    }
  }
  // Default to last shard if not found
  return boundaries.length - 1
}

/**
 * Verify uniform distribution across shards
 * Returns the coefficient of variation (lower is better, 0 = perfect)
 */
export function calculateDistributionUniformity(
  partitions: Map<number, unknown[]>
): number {
  const counts = Array.from(partitions.values()).map((p) => p.length)
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const variance =
    counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length
  const stdDev = Math.sqrt(variance)

  // Coefficient of variation (CV) - percentage
  return mean === 0 ? 0 : (stdDev / mean) * 100
}

/**
 * Create SQL data map from fixtures for mock DO setup
 */
export function createSqlDataFromFixtures(
  things: TestThing[],
  shardRegistry?: ShardRegistryEntry[]
): Map<string, unknown[]> {
  const sqlData = new Map<string, unknown[]>()

  sqlData.set('things', things)
  sqlData.set('branches', [
    { name: 'main', head: things.length, forkedFrom: null, createdAt: new Date().toISOString() },
  ])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('relationships', [])

  // Add shard registry to objects table if provided
  if (shardRegistry) {
    sqlData.set('objects', shardRegistry)
  } else {
    sqlData.set('objects', [])
  }

  return sqlData
}

export default PHASE3_FIXTURES
