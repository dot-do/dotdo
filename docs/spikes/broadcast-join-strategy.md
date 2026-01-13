# Broadcast Join Without Shuffle Network

**Issue:** dotdo-wk6p0
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** Complete

## Executive Summary

This spike investigates broadcast join strategies for distributed queries in the Durable Object (DO) model without requiring a traditional shuffle network. The key insight is that **Cloudflare's DO architecture with independent subrequest budgets enables efficient broadcast join patterns** that avoid the network overhead of shuffle-based approaches.

**Key Findings:**
1. Broadcast joins are optimal when one join side has < 10,000 rows (fits in ~1MB serialized)
2. The DO hierarchy enables parallel broadcast to 1,000+ targets in a single coordinated request
3. Combining broadcast with Cap'n Web promise pipelining achieves single round-trip joins
4. Size thresholds should be dynamic based on network conditions and table statistics

## Background: Why No Shuffle Network?

### Traditional Distributed Joins

In systems like Spark, Presto, or traditional MPP databases, joins across distributed data use shuffle networks:

```
Traditional Shuffle Join:
========================

  Node A          Node B          Node C
  ┌─────┐         ┌─────┐         ┌─────┐
  │ A1  │         │ B1  │         │ C1  │
  │ A2  │         │ B2  │         │ C2  │
  │ A3  │         │ B3  │         │ C3  │
  └──┬──┘         └──┬──┘         └──┬──┘
     │               │               │
     └───────┬───────┴───────┬───────┘
             │  SHUFFLE       │
             │  NETWORK       │
     ┌───────┼───────────────┼───────┐
     ▼       ▼               ▼       ▼
  ┌─────┐ ┌─────┐         ┌─────┐ ┌─────┐
  │Hash │ │Hash │   ...   │Hash │ │Hash │
  │  0  │ │  1  │         │ N-1 │ │  N  │
  └─────┘ └─────┘         └─────┘ └─────┘
```

**Problems with shuffle in the DO model:**
1. **No persistent interconnects** - DOs communicate via HTTP fetch, not persistent connections
2. **Stateless workers** - No worker-level state for shuffle buffers
3. **Subrequest budgets** - Limited to 1,000 subrequests per DO, not suitable for all-to-all communication
4. **Geographic distribution** - DOs may be in different colos, adding latency

### The DO Alternative: Broadcast + Fan-Out

Instead of shuffle, we leverage the DO hierarchy for broadcast-based joins:

```
Broadcast Join in DO Model:
===========================

                    Coordinator DO
                    ┌───────────────┐
                    │ Small Table   │
                    │ (broadcast)   │
                    │ [1,000 rows]  │
                    └───────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            │  BROADCAST    │   BROADCAST   │
            ▼               ▼               ▼
       ┌─────────┐    ┌─────────┐    ┌─────────┐
       │ Shard 0 │    │ Shard 1 │    │ Shard 2 │
       │ Large   │    │ Large   │    │ Large   │
       │ Table   │    │ Table   │    │ Table   │
       │ Slice   │    │ Slice   │    │ Slice   │
       └────┬────┘    └────┬────┘    └────┬────┘
            │              │              │
            │   LOCAL      │   LOCAL      │   LOCAL
            │   JOIN       │   JOIN       │   JOIN
            ▼              ▼              ▼
       ┌─────────┐    ┌─────────┐    ┌─────────┐
       │ Partial │    │ Partial │    │ Partial │
       │ Results │    │ Results │    │ Results │
       └────┬────┘    └────┬────┘    └────┬────┘
            │              │              │
            └───────┬──────┴──────┬───────┘
                    │  AGGREGATE  │
                    ▼             ▼
                    ┌───────────────┐
                    │ Final Results │
                    └───────────────┘
```

## Broadcast Join Algorithm

### When to Use Broadcast Join

Based on analysis of existing code and benchmarks:

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Row count | < 10,000 rows | Fits in DO memory |
| Serialized size | < 1MB | Single fetch payload |
| Cardinality ratio | < 1:100 | Small vs large table |
| Join selectivity | < 10% match rate | Bloom filter alternative |

From `docs/spikes/cross-do-join-latency.md`:
> "Use broadcast join when one side has < 1000 rows"

This is conservative. Based on memory analysis:
- DO memory limit: 128MB
- Typical row: 100-500 bytes serialized
- Safe broadcast size: 10,000 rows * 500 bytes = 5MB

### Algorithm Steps

```typescript
interface BroadcastJoinPlan {
  broadcastSide: 'left' | 'right'
  broadcastTable: string
  estimatedBroadcastSize: number
  targetShards: string[]
  joinKey: string
  joinType: 'inner' | 'left' | 'right'
}

function planBroadcastJoin(
  leftStats: TableStatistics,
  rightStats: TableStatistics,
  joinCondition: JoinCondition
): BroadcastJoinPlan | null {
  const BROADCAST_THRESHOLD_ROWS = 10_000
  const BROADCAST_THRESHOLD_BYTES = 1_000_000 // 1MB

  // Determine which side is smaller
  const leftSize = leftStats.rowCount * leftStats.avgRowSize
  const rightSize = rightStats.rowCount * rightStats.avgRowSize

  // Check if either side qualifies for broadcast
  if (leftStats.rowCount < BROADCAST_THRESHOLD_ROWS &&
      leftSize < BROADCAST_THRESHOLD_BYTES) {
    return {
      broadcastSide: 'left',
      broadcastTable: leftStats.tableName,
      estimatedBroadcastSize: leftSize,
      targetShards: rightStats.shardIds,
      joinKey: joinCondition.leftKey,
      joinType: 'inner'
    }
  }

  if (rightStats.rowCount < BROADCAST_THRESHOLD_ROWS &&
      rightSize < BROADCAST_THRESHOLD_BYTES) {
    return {
      broadcastSide: 'right',
      broadcastTable: rightStats.tableName,
      estimatedBroadcastSize: rightSize,
      targetShards: leftStats.shardIds,
      joinKey: joinCondition.rightKey,
      joinType: 'inner'
    }
  }

  return null // Fall back to other join strategy
}
```

### Execution Flow

```typescript
async function executeBroadcastJoin(
  plan: BroadcastJoinPlan,
  coordinator: CoordinatorDO
): Promise<JoinResult> {

  // Step 1: Fetch broadcast table (single DO call)
  const broadcastData = await coordinator.fetchTable(plan.broadcastTable)

  // Step 2: Build hash table for join key
  const hashTable = buildHashTable(broadcastData, plan.joinKey)

  // Step 3: Serialize for broadcast (optimize for network)
  const payload = serializeBroadcast({
    hashTable,
    joinKey: plan.joinKey,
    joinType: plan.joinType
  })

  // Step 4: Fan-out to all shards in parallel
  const shardPromises = plan.targetShards.map(shardId =>
    coordinator.callShard(shardId, 'localJoin', payload)
  )

  // Step 5: Aggregate results
  const partialResults = await Promise.all(shardPromises)
  return aggregateResults(partialResults)
}
```

## DO-Specific Implementation

### Leveraging the Subrequest Budget

From `internal/plans/unified-analytics-architecture.md`:
> "Each Durable Object gets an independent 1,000 internal subrequest budget"

This enables massive parallel broadcast:

```
Broadcast Capacity:
==================

Single Coordinator DO:
  - 1,000 subrequests available
  - Can broadcast to up to 999 Shard DOs
  - Each shard can scan its local partition

Two-Tier Hierarchy:
  - Coordinator → 32 Region DOs
  - Each Region → 31 Shard DOs
  - Total: 992 shards reachable
  - Each shard receives broadcast payload once
```

### Integration with Cap'n Web RPC

From `objects/transport/rpc-server.ts`, the existing RPC infrastructure supports promise pipelining:

```typescript
// Pipelined broadcast join - single round trip
const userPromise = coordinator.getBroadcastTable('customers')
const ordersPromise = shards.map(shard =>
  shard.joinWith(userPromise)  // Promise passed directly
)
const results = await Promise.all(ordersPromise)
```

**Latency benefit:**
- Without pipelining: fetch broadcast table + N shard calls = N+1 round trips
- With pipelining: 1 round trip (promise pipelining)

### Memory-Efficient Broadcast Format

For large broadcast tables, use columnar format:

```typescript
interface ColumnBroadcast {
  // Column-oriented for better compression
  columns: Map<string, ArrayBuffer>

  // Bloom filter for fast negative lookups
  bloomFilter: Uint8Array

  // Metadata
  rowCount: number
  schema: ColumnSchema[]
}

function serializeColumnBroadcast(
  rows: Record<string, unknown>[],
  joinKey: string
): ColumnBroadcast {
  const columns = new Map<string, ArrayBuffer>()

  // Transpose row-oriented to column-oriented
  for (const col of Object.keys(rows[0] || {})) {
    const values = rows.map(r => r[col])
    columns.set(col, encodeColumn(values))
  }

  // Build bloom filter for join key
  const bloomFilter = buildBloomFilter(
    rows.map(r => r[joinKey]),
    { fpr: 0.01, size: Math.ceil(rows.length * 10) }
  )

  return { columns, bloomFilter, rowCount: rows.length, schema: [] }
}
```

## Size Threshold Analysis

### Static Thresholds (Current)

From `db/duckdb-distributed/index.ts`:
```typescript
const smallTables = ['customers', 'products', 'inventory']
if (smallTables.includes(joinTable)) {
  return 'broadcast'
}
```

This is too rigid. Tables grow over time.

### Dynamic Thresholds (Recommended)

```typescript
interface BroadcastThresholds {
  // Base thresholds
  maxRows: number           // Default: 10,000
  maxBytes: number          // Default: 1MB

  // Dynamic adjustments
  networkLatencyMs: number  // Higher latency = lower threshold
  shardCount: number        // More shards = more expensive broadcast
  concurrentQueries: number // High load = lower threshold
}

function calculateDynamicThreshold(
  baseThreshold: number,
  context: QueryContext
): number {
  let threshold = baseThreshold

  // Reduce threshold if network is slow
  if (context.avgLatencyMs > 50) {
    threshold *= 0.5  // Halve for high latency
  }

  // Reduce threshold for many shards (broadcast cost grows linearly)
  if (context.shardCount > 100) {
    threshold *= 100 / context.shardCount
  }

  // Reduce during high load
  if (context.concurrentQueries > 10) {
    threshold *= 0.7
  }

  return Math.max(threshold, 100)  // Minimum 100 rows
}
```

### Threshold Decision Matrix

| Scenario | Rows | Bytes | Shards | Strategy |
|----------|------|-------|--------|----------|
| Small lookup table | < 1,000 | < 100KB | Any | Broadcast |
| Medium dimension table | 1,000-10,000 | < 1MB | < 100 | Broadcast |
| Large dimension table | 10,000-100,000 | < 10MB | < 10 | Broadcast with compression |
| Large table | > 100,000 | > 10MB | Any | Hash join or semi-join |
| Very selective filter | Any | Any | Any | Semi-join with predicate pushdown |

## Alternative Strategies When Broadcast is Not Suitable

### 1. Semi-Join with Predicate Pushdown

When one side is large but highly filtered:

```typescript
// Step 1: Get matching IDs from first DO (filter pushed down)
const matchingIds = await ordersD0.query({
  select: ['customerId'],
  where: { status: 'active', amount: { $gt: 1000 } }
})

// Step 2: Fetch only matching records from second DO
const customers = await customersD0.getBatch(matchingIds)
```

From `docs/spikes/cross-do-join-latency.md`:
> "Use semi-join when selectivity < 10%"

### 2. Bloom Filter Pre-filtering

When match rate is low:

```typescript
// Step 1: Build bloom filter from join keys at source
const bloomFilter = await sourceD0.buildBloomFilter('/join-keys', { fpr: 0.01 })

// Step 2: Broadcast bloom filter (much smaller than full data)
const candidates = await targetD0.probeBloom(bloomFilter)

// Step 3: Fetch only candidates
const matches = await targetD0.getBatch(candidates)
```

**Network savings:** Up to 90%+ for sparse joins

### 3. Partitioned Hash Join

When both sides are large:

```typescript
// Partition both sides by join key hash
const leftPartitions = partitionByHash(leftData, 'customerId', 32)
const rightPartitions = partitionByHash(rightData, 'id', 32)

// Join matching partitions locally
const results = await Promise.all(
  leftPartitions.map((partition, i) =>
    joinPartitions(partition, rightPartitions[i])
  )
)
```

## Implementation Recommendations

### Phase 1: Statistics Infrastructure

Before implementing broadcast joins, ensure table statistics are available:

```typescript
interface TableStatistics {
  rowCount: number
  avgRowSize: number
  distinctCounts: Map<string, number>
  minMax: Map<string, { min: unknown; max: unknown }>
  lastUpdated: number
  shardDistribution: Map<string, number>
}

// Add to DOBase
class DOBase {
  async getStatistics(): Promise<TableStatistics> {
    // Aggregate from all shards
  }

  async refreshStatistics(): Promise<void> {
    // Periodically update via alarm
  }
}
```

### Phase 2: Query Planner Integration

Integrate broadcast join decision into the existing `QueryPlanner`:

```typescript
// db/primitives/query-engine/planner/query-planner.ts
planJoin(join: JoinNode): QueryPlan {
  const leftStats = this.getTableStatistics(join.left)
  const rightStats = this.getTableStatistics(join.right)

  // NEW: Check for broadcast eligibility first
  const broadcastPlan = this.planBroadcastJoin(leftStats, rightStats, join)
  if (broadcastPlan) {
    return broadcastPlan
  }

  // Existing logic: hash join, sort-merge, etc.
  // ...
}
```

### Phase 3: DO-Level Broadcast Support

Add broadcast join primitives to `DOBase`:

```typescript
// objects/DOBase.ts
class DOBase {
  // Receive broadcast payload and execute local join
  async receiveAndJoin(
    broadcastPayload: ColumnBroadcast,
    localTable: string,
    joinKey: string
  ): Promise<JoinResult> {
    // 1. Deserialize broadcast
    // 2. Build local hash table
    // 3. Scan local partition
    // 4. Return matches
  }

  // Fan-out broadcast to shards
  async broadcastJoin(
    smallTable: string,
    largeTable: string,
    joinKey: string
  ): Promise<JoinResult> {
    // 1. Fetch small table
    // 2. Serialize for broadcast
    // 3. Fan-out to all shards
    // 4. Aggregate results
  }
}
```

### Phase 4: Promise Pipelining Integration

Leverage Cap'n Web RPC for single round-trip broadcast:

```typescript
// Using capnweb protocol
import { capnweb } from '@dotdo/capnweb'

async function pipelinedBroadcastJoin(
  coordinator: CoordinatorStub,
  smallTable: string,
  shards: ShardStub[]
): Promise<JoinResult[]> {
  // This entire operation completes in ONE network round trip
  const broadcastPromise = coordinator.getBroadcastTable(smallTable)

  return Promise.all(
    shards.map(shard => shard.joinWith(broadcastPromise))
  )
}
```

## Cost Model

### Broadcast Join Cost

```
Cost(broadcast) =
  fetch_small_table_cost +                    // Single DO call
  serialize_cost +                            // O(small_table_size)
  N_shards * (deserialize + local_scan) +    // Parallel
  aggregate_cost                              // O(result_size)
```

### Hash Join Cost (for comparison)

```
Cost(hash_join) =
  N_shards * (fetch_partition) +              // All shards
  build_hash_table_cost +                     // O(smaller side)
  probe_cost +                                // O(larger side)
  shuffle_cost                                // N * M network calls (avoided!)
```

### When Broadcast Wins

Broadcast is cheaper when:
```
small_table_size * N_shards < shuffle_network_overhead
```

With typical DO latency (~5ms same-colo):
- Broadcast of 1MB to 100 shards: ~500ms
- Hash join with shuffle: ~5000ms (100 * 100 * 0.5ms)

**Broadcast is ~10x faster for qualifying joins.**

## Conclusion

Broadcast joins are the optimal strategy for Durable Object-based distributed queries when:
1. One join side has fewer than 10,000 rows
2. Serialized size is under 1MB
3. The join is frequently executed (amortize broadcast cost)

The implementation should:
1. Collect table statistics automatically
2. Dynamically select broadcast vs hash join based on statistics
3. Use columnar format with bloom filters for efficient broadcast
4. Leverage Cap'n Web promise pipelining for single round-trip execution

## References

- `docs/spikes/cross-do-join-latency.md` - Cross-DO join latency analysis
- `db/duckdb-distributed/index.ts` - Distributed DuckDB implementation
- `db/primitives/query-engine/planner/query-planner.ts` - Query planner
- `db/primitives/semantic-layer/join-path.ts` - Join path resolution
- `internal/plans/unified-analytics-architecture.md` - DO hierarchy architecture
- `objects/transport/rpc-server.ts` - RPC server with promise pipelining
