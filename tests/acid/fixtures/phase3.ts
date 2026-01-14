/**
 * ACID Test Suite - Phase 3: Sharding Fixtures
 *
 * Shared fixtures and test data for Phase 3 sharding tests.
 * Used by all shard operation tests.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 3 Sharding
 */

import type { ShardStrategy } from '../../../types/Lifecycle'
import type { ObjectRelationType } from '../../../db/objects'

// ============================================================================
// SHARD TYPE DEFINITIONS
// ============================================================================

/**
 * Shard info stored in the objects registry
 */
export interface ShardInfo {
  /** Namespace URL of the shard DO */
  ns: string
  /** Cloudflare DO ID */
  doId: string
  /** DO class name */
  class: string
  /** Relation type (should be 'shard') */
  relation: ObjectRelationType
  /** Key used for sharding */
  shardKey: string
  /** Index of this shard (0-based) */
  shardIndex: number
  /** Number of things in this shard */
  thingCount?: number
  /** Creation timestamp */
  createdAt: Date
}

/**
 * Shard coordinator state
 */
export interface ShardCoordinatorState {
  /** Whether this DO is a shard coordinator */
  isCoordinator: boolean
  /** Key used for sharding */
  shardKey: string
  /** Total number of shards */
  shardCount: number
  /** Sharding strategy */
  strategy: ShardStrategy
  /** Array of shard info */
  shards: ShardInfo[]
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
}

/**
 * Shard routing table entry
 */
export interface RoutingTableEntry {
  /** Shard index */
  index: number
  /** Shard namespace */
  ns: string
  /** Shard DO ID */
  doId: string
  /** For range-based: start of range (inclusive) */
  rangeStart?: string
  /** For range-based: end of range (exclusive) */
  rangeEnd?: string
}

/**
 * Cross-shard query result
 */
export interface CrossShardResult<T> {
  /** Results from each shard */
  shardResults: Map<number, T>
  /** Errors from each shard (if any) */
  shardErrors: Map<number, Error>
  /** Total items returned */
  totalItems: number
  /** Duration of the query in ms */
  durationMs: number
  /** Whether any shards failed */
  hasErrors: boolean
}

/**
 * Unshard conflict info
 */
export interface UnshardConflict {
  /** Thing ID that conflicts */
  thingId: string
  /** Shard indices that have this thing */
  shardIndices: number[]
  /** Resolution strategy applied */
  resolution: 'last-write-wins' | 'first-wins' | 'merge' | 'manual'
  /** Winning shard index */
  winningShard?: number
}

// ============================================================================
// MOCK THING TYPE (for fixtures)
// ============================================================================

/**
 * Mock Thing data for testing
 */
export interface MockThing {
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown>
  deleted: boolean
  version?: number
  rowid?: number
}

// ============================================================================
// LARGE DATASET FIXTURES
// ============================================================================

/**
 * Generate a large dataset for sharding tests
 * Creates 1000 things with varied data for distribution testing
 */
export function generateLargeDataset(count: number = 1000): MockThing[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i.toString().padStart(4, '0')}`,
    type: 1,
    branch: null,
    name: `Thing ${i}`,
    data: {
      value: i,
      category: ['A', 'B', 'C', 'D'][i % 4],
      region: ['us-east', 'us-west', 'eu-west', 'asia-pacific'][i % 4],
      priority: ['low', 'medium', 'high', 'critical'][i % 4],
      score: Math.floor(i / 10),
      tags: [`tag-${i % 10}`, `group-${Math.floor(i / 100)}`],
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
    },
    deleted: false,
    version: 1,
  }))
}

/**
 * Large dataset fixture (1000 things)
 */
export const LARGE_DATASET = generateLargeDataset(1000)

/**
 * Medium dataset fixture (100 things) for faster tests
 */
export const MEDIUM_DATASET = generateLargeDataset(100)

/**
 * Small dataset fixture (10 things) for unit tests
 */
export const SMALL_DATASET = generateLargeDataset(10)

// ============================================================================
// SHARD REGISTRY FIXTURES
// ============================================================================

/**
 * Pre-configured 4-shard registry
 */
export const SHARD_REGISTRY_4: ShardInfo[] = [
  {
    ns: 'https://test.do/shard/0',
    doId: 'shard-do-id-0',
    class: 'DO',
    relation: 'shard' as ObjectRelationType,
    shardKey: 'id',
    shardIndex: 0,
    thingCount: 250,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    ns: 'https://test.do/shard/1',
    doId: 'shard-do-id-1',
    class: 'DO',
    relation: 'shard' as ObjectRelationType,
    shardKey: 'id',
    shardIndex: 1,
    thingCount: 250,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    ns: 'https://test.do/shard/2',
    doId: 'shard-do-id-2',
    class: 'DO',
    relation: 'shard' as ObjectRelationType,
    shardKey: 'id',
    shardIndex: 2,
    thingCount: 250,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    ns: 'https://test.do/shard/3',
    doId: 'shard-do-id-3',
    class: 'DO',
    relation: 'shard' as ObjectRelationType,
    shardKey: 'id',
    shardIndex: 3,
    thingCount: 250,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
]

/**
 * Pre-configured 8-shard registry for larger tests
 */
export const SHARD_REGISTRY_8: ShardInfo[] = Array.from({ length: 8 }, (_, i) => ({
  ns: `https://test.do/shard/${i}`,
  doId: `shard-do-id-${i}`,
  class: 'DO',
  relation: 'shard' as ObjectRelationType,
  shardKey: 'id',
  shardIndex: i,
  thingCount: 125,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}))

// ============================================================================
// SHARDED PARTITION FIXTURES
// ============================================================================

/**
 * Generate sharded partitions from a dataset using hash strategy
 */
export function generateHashPartitions(
  things: MockThing[],
  shardCount: number,
  key: string = 'id'
): Map<number, MockThing[]> {
  const partitions = new Map<number, MockThing[]>()

  // Initialize empty arrays for each shard
  for (let i = 0; i < shardCount; i++) {
    partitions.set(i, [])
  }

  // Distribute things using hash
  for (const thing of things) {
    const keyValue = key === 'id' ? thing.id : String((thing.data as Record<string, unknown>)[key] ?? thing.id)
    const hash = simpleHash(keyValue)
    const shardIndex = hash % shardCount
    partitions.get(shardIndex)!.push(thing)
  }

  return partitions
}

/**
 * Generate sharded partitions using round-robin strategy
 */
export function generateRoundRobinPartitions(
  things: MockThing[],
  shardCount: number
): Map<number, MockThing[]> {
  const partitions = new Map<number, MockThing[]>()

  // Initialize empty arrays for each shard
  for (let i = 0; i < shardCount; i++) {
    partitions.set(i, [])
  }

  // Distribute things round-robin
  for (let i = 0; i < things.length; i++) {
    const shardIndex = i % shardCount
    partitions.get(shardIndex)!.push(things[i])
  }

  return partitions
}

/**
 * Generate sharded partitions using range strategy
 */
export function generateRangePartitions(
  things: MockThing[],
  shardCount: number,
  key: string = 'id'
): Map<number, MockThing[]> {
  const partitions = new Map<number, MockThing[]>()

  // Initialize empty arrays for each shard
  for (let i = 0; i < shardCount; i++) {
    partitions.set(i, [])
  }

  // Sort things by key
  const sorted = [...things].sort((a, b) => {
    const keyA = key === 'id' ? a.id : String((a.data as Record<string, unknown>)[key] ?? a.id)
    const keyB = key === 'id' ? b.id : String((b.data as Record<string, unknown>)[key] ?? b.id)
    return keyA.localeCompare(keyB)
  })

  // Distribute evenly across shards
  const itemsPerShard = Math.ceil(sorted.length / shardCount)
  for (let i = 0; i < sorted.length; i++) {
    const shardIndex = Math.min(Math.floor(i / itemsPerShard), shardCount - 1)
    partitions.get(shardIndex)!.push(sorted[i])
  }

  return partitions
}

/**
 * Pre-distributed 4-shard partitions for LARGE_DATASET using hash
 */
export const HASH_PARTITIONS_4 = generateHashPartitions(LARGE_DATASET, 4)

/**
 * Pre-distributed 4-shard partitions using round-robin
 */
export const ROUNDROBIN_PARTITIONS_4 = generateRoundRobinPartitions(LARGE_DATASET, 4)

/**
 * Pre-distributed 4-shard partitions using range
 */
export const RANGE_PARTITIONS_4 = generateRangePartitions(LARGE_DATASET, 4)

// ============================================================================
// RANGE BOUNDARY FIXTURES
// ============================================================================

/**
 * Range boundaries for 4-shard range-based sharding of 1000 items
 */
export const RANGE_BOUNDARIES_4 = [
  { shardIndex: 0, start: 'thing-0000', end: 'thing-0249' },
  { shardIndex: 1, start: 'thing-0250', end: 'thing-0499' },
  { shardIndex: 2, start: 'thing-0500', end: 'thing-0749' },
  { shardIndex: 3, start: 'thing-0750', end: 'thing-0999' },
]

/**
 * Range boundaries for 8-shard range-based sharding
 */
export const RANGE_BOUNDARIES_8 = [
  { shardIndex: 0, start: 'thing-0000', end: 'thing-0124' },
  { shardIndex: 1, start: 'thing-0125', end: 'thing-0249' },
  { shardIndex: 2, start: 'thing-0250', end: 'thing-0374' },
  { shardIndex: 3, start: 'thing-0375', end: 'thing-0499' },
  { shardIndex: 4, start: 'thing-0500', end: 'thing-0624' },
  { shardIndex: 5, start: 'thing-0625', end: 'thing-0749' },
  { shardIndex: 6, start: 'thing-0750', end: 'thing-0874' },
  { shardIndex: 7, start: 'thing-0875', end: 'thing-0999' },
]

// ============================================================================
// CONFLICT FIXTURES (for unshard tests)
// ============================================================================

/**
 * Things that exist with same ID across multiple shards (conflict scenario)
 */
export const CONFLICTING_THINGS: Array<{
  thingId: string
  versions: Array<{ shardIndex: number; version: number; data: Record<string, unknown> }>
}> = [
  {
    thingId: 'conflict-1',
    versions: [
      { shardIndex: 0, version: 1, data: { value: 'from-shard-0', updatedAt: '2026-01-01T00:00:00Z' } },
      { shardIndex: 2, version: 3, data: { value: 'from-shard-2', updatedAt: '2026-01-01T00:30:00Z' } },
    ],
  },
  {
    thingId: 'conflict-2',
    versions: [
      { shardIndex: 1, version: 2, data: { value: 'from-shard-1', updatedAt: '2026-01-01T00:10:00Z' } },
      { shardIndex: 3, version: 2, data: { value: 'from-shard-3', updatedAt: '2026-01-01T00:20:00Z' } },
    ],
  },
  {
    thingId: 'conflict-3',
    versions: [
      { shardIndex: 0, version: 5, data: { value: 'shard-0-v5' } },
      { shardIndex: 1, version: 3, data: { value: 'shard-1-v3' } },
      { shardIndex: 2, version: 7, data: { value: 'shard-2-v7' } },
      { shardIndex: 3, version: 4, data: { value: 'shard-3-v4' } },
    ],
  },
]

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simple hash function for deterministic shard routing
 * Uses djb2 algorithm for consistent distribution
 */
export function simpleHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return Math.abs(hash)
}

/**
 * Route a key to a shard using hash strategy
 */
export function hashRoute(key: string, shardCount: number): number {
  return simpleHash(key) % shardCount
}

/**
 * Route a key to a shard using range strategy
 */
export function rangeRoute(
  key: string,
  boundaries: Array<{ shardIndex: number; start: string; end: string }>
): number {
  for (const boundary of boundaries) {
    if (key >= boundary.start && key <= boundary.end) {
      return boundary.shardIndex
    }
  }
  // Default to last shard if out of range
  return boundaries[boundaries.length - 1].shardIndex
}

/**
 * Verify shard distribution is even
 */
export function verifyEvenDistribution(
  partitions: Map<number, MockThing[]>,
  tolerance: number = 0.2
): { even: boolean; deviation: number; shardCounts: number[] } {
  const shardCounts = Array.from(partitions.values()).map((p) => p.length)
  const average = shardCounts.reduce((a, b) => a + b, 0) / shardCounts.length
  const maxDeviation = Math.max(...shardCounts.map((c) => Math.abs(c - average) / average))

  return {
    even: maxDeviation <= tolerance,
    deviation: maxDeviation,
    shardCounts,
  }
}

/**
 * Verify no data loss during sharding (total count matches)
 */
export function verifyNoDataLoss(
  original: MockThing[],
  partitions: Map<number, MockThing[]>
): { valid: boolean; originalCount: number; partitionedCount: number } {
  const partitionedCount = Array.from(partitions.values()).reduce((sum, p) => sum + p.length, 0)

  return {
    valid: original.length === partitionedCount,
    originalCount: original.length,
    partitionedCount,
  }
}

/**
 * Find all thing IDs that appear in multiple partitions
 */
export function findDuplicates(partitions: Map<number, MockThing[]>): string[] {
  const seen = new Map<string, number[]>()

  for (const [shardIndex, things] of partitions) {
    for (const thing of things) {
      const existing = seen.get(thing.id) || []
      existing.push(shardIndex)
      seen.set(thing.id, existing)
    }
  }

  return Array.from(seen.entries())
    .filter(([_, shards]) => shards.length > 1)
    .map(([id]) => id)
}

// ============================================================================
// SHARD COORDINATOR FIXTURES
// ============================================================================

/**
 * Default coordinator state for a 4-shard setup
 */
export const DEFAULT_COORDINATOR_STATE: ShardCoordinatorState = {
  isCoordinator: true,
  shardKey: 'id',
  shardCount: 4,
  strategy: 'hash',
  shards: SHARD_REGISTRY_4,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

/**
 * Routing table for 4-shard hash-based setup
 */
export const ROUTING_TABLE_4: RoutingTableEntry[] = SHARD_REGISTRY_4.map((shard) => ({
  index: shard.shardIndex,
  ns: shard.ns,
  doId: shard.doId,
}))

/**
 * Routing table with range boundaries
 */
export const ROUTING_TABLE_4_RANGE: RoutingTableEntry[] = SHARD_REGISTRY_4.map((shard, i) => ({
  index: shard.shardIndex,
  ns: shard.ns,
  doId: shard.doId,
  rangeStart: RANGE_BOUNDARIES_4[i].start,
  rangeEnd: RANGE_BOUNDARIES_4[i].end,
}))

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a shard coordinator state fixture
 */
export function createCoordinatorState(
  overrides: Partial<ShardCoordinatorState> = {}
): ShardCoordinatorState {
  return {
    ...DEFAULT_COORDINATOR_STATE,
    ...overrides,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

/**
 * Create a shard info fixture
 */
export function createShardInfo(
  shardIndex: number,
  overrides: Partial<ShardInfo> = {}
): ShardInfo {
  return {
    ns: `https://test.do/shard/${shardIndex}`,
    doId: `shard-do-id-${shardIndex}`,
    class: 'DO',
    relation: 'shard' as ObjectRelationType,
    shardKey: 'id',
    shardIndex,
    thingCount: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

/**
 * Create a cross-shard result fixture
 */
export function createCrossShardResult<T>(
  shardResults: Map<number, T>,
  options: {
    errors?: Map<number, Error>
    durationMs?: number
  } = {}
): CrossShardResult<T> {
  const shardErrors = options.errors ?? new Map()
  let totalItems = 0

  for (const result of shardResults.values()) {
    if (Array.isArray(result)) {
      totalItems += result.length
    } else {
      totalItems += 1
    }
  }

  return {
    shardResults,
    shardErrors,
    totalItems,
    durationMs: options.durationMs ?? 100,
    hasErrors: shardErrors.size > 0,
  }
}

/**
 * Create an unshard conflict fixture
 */
export function createUnshardConflict(
  thingId: string,
  shardIndices: number[],
  resolution: UnshardConflict['resolution'] = 'last-write-wins'
): UnshardConflict {
  return {
    thingId,
    shardIndices,
    resolution,
    winningShard: resolution === 'first-wins' ? Math.min(...shardIndices) : Math.max(...shardIndices),
  }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert shard distribution is valid
 */
export function assertValidDistribution(
  partitions: Map<number, MockThing[]>,
  originalCount: number,
  options: { tolerance?: number } = {}
): void {
  const { tolerance = 0.2 } = options

  // Check no data loss
  const dataLoss = verifyNoDataLoss(
    Array.from({ length: originalCount }, (_, i) => ({ id: `thing-${i}` } as MockThing)),
    partitions
  )
  if (!dataLoss.valid) {
    throw new Error(
      `Data loss detected: original=${dataLoss.originalCount}, partitioned=${dataLoss.partitionedCount}`
    )
  }

  // Check even distribution
  const distribution = verifyEvenDistribution(partitions, tolerance)
  if (!distribution.even) {
    throw new Error(
      `Uneven distribution: deviation=${(distribution.deviation * 100).toFixed(1)}%, counts=${distribution.shardCounts.join(', ')}`
    )
  }

  // Check no duplicates
  const duplicates = findDuplicates(partitions)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate things found: ${duplicates.slice(0, 5).join(', ')}...`)
  }
}

/**
 * Assert shard routing is deterministic
 */
export function assertDeterministicRouting(
  key: string,
  shardCount: number,
  iterations: number = 100
): void {
  const firstRoute = hashRoute(key, shardCount)

  for (let i = 0; i < iterations; i++) {
    const route = hashRoute(key, shardCount)
    if (route !== firstRoute) {
      throw new Error(
        `Non-deterministic routing for key "${key}": expected ${firstRoute}, got ${route} on iteration ${i}`
      )
    }
  }
}

/**
 * Assert cross-shard query completed successfully
 */
export function assertCrossShardSuccess<T>(result: CrossShardResult<T>): void {
  if (result.hasErrors) {
    const errors = Array.from(result.shardErrors.entries())
      .map(([shard, err]) => `shard ${shard}: ${err.message}`)
      .join(', ')
    throw new Error(`Cross-shard query had errors: ${errors}`)
  }
}
