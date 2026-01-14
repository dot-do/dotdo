/**
 * Phase 3 ACID Test Suite - Sharding
 *
 * Re-exports all Phase 3 test utilities and fixtures for sharding operations.
 *
 * Test Files:
 * - shard.test.ts: DO.shard() operation tests
 * - shard-strategies.test.ts: Strategy-specific tests (hash, range, roundRobin, custom)
 * - shard-routing.test.ts: Shard routing and routing table tests
 * - cross-shard.test.ts: Scatter-gather cross-shard query tests
 * - unshard.test.ts: DO.unshard() operation tests
 * - shard-coordinator.test.ts: Coordinator behavior tests
 *
 * @see types/Lifecycle.ts for ShardStrategy, ShardOptions, ShardResult, UnshardOptions
 * @see db/objects.ts for objects table shard schema
 */

// Re-export fixtures
export {
  PHASE3_FIXTURES,
  createLargeDataset,
  createShardRegistry,
  createShardedPartitions,
  createRangeBoundaries,
  createConflictingThings,
  calculateHashShardIndex,
  calculateRangeShardIndex,
  calculateDistributionUniformity,
  createSqlDataFromFixtures,
} from '../fixtures/phase3'

export type {
  TestThing,
  ShardRegistryEntry,
  RangeBoundary,
} from '../fixtures/phase3'

// Re-export mocks
export {
  createMockShardCoordinator,
  createMockShardResult,
  validateShardOptions,
  calculateIdealDistribution,
} from '../mocks/shard-coordinator'

export type {
  ShardInfo,
  RoutingEntry,
  ScatterGatherOptions,
  ScatterGatherResult,
  CustomShardFunction,
  MockShardCoordinator,
} from '../mocks/shard-coordinator'

// Phase 3 test coverage summary
export const PHASE3_TEST_COVERAGE = {
  operations: {
    shard: {
      file: 'shard.test.ts',
      tests: [
        'Basic functionality (create shards, distribute things)',
        'Validation (count, key, already-sharded)',
        'Sharding strategies (hash, range, roundRobin)',
        'Clone mode integration (atomic, staged, eventual, resumable)',
        'ACID properties (atomicity, consistency, isolation, durability)',
        'Event emission (started, progress, completed, failed)',
        'Shard key options (id, type, custom field)',
        'Edge cases (small dataset, concurrent requests)',
      ],
    },
    unshard: {
      file: 'unshard.test.ts',
      tests: [
        'Basic functionality (merge, cleanup)',
        'Target selection (coordinator, new DO, first shard)',
        'Clone mode integration',
        'Conflict resolution (same ID, merge strategy)',
        'Validation (non-sharded, target exists, reachability)',
        'ACID properties',
        'Event emission',
        'Edge cases (empty shards, partial failures)',
      ],
    },
  },
  infrastructure: {
    strategies: {
      file: 'shard-strategies.test.ts',
      tests: [
        'Hash strategy (determinism, distribution)',
        'Range strategy (boundaries, partitioning)',
        'RoundRobin strategy (even distribution)',
        'Custom strategy (user function)',
        'Strategy comparison',
      ],
    },
    routing: {
      file: 'shard-routing.test.ts',
      tests: [
        'Hash-based routing (determinism, uniformity)',
        'Range-based routing (boundaries, out-of-range)',
        'Routing table management',
        'Cross-DO resolution',
        'Circuit breaker per shard',
        'Routing consistency',
      ],
    },
    crossShard: {
      file: 'cross-shard.test.ts',
      tests: [
        'Scatter-gather (parallel queries, aggregation)',
        'Query types (list, find, count, aggregates)',
        'Result merging (sort, limit, offset)',
        'Error handling (partial failures, retries)',
        'ACID properties for reads',
        'Performance (parallel execution)',
      ],
    },
    coordinator: {
      file: 'shard-coordinator.test.ts',
      tests: [
        'Role assignment (original DO becomes coordinator)',
        'Registry management (registration, updates, removal)',
        'Cross-DO coordination (routing, aggregation)',
        'Health monitoring (detection, circuit breaker)',
        'Rebalancing (initiate, availability, atomic updates)',
      ],
    },
  },
}
