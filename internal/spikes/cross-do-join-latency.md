# Cross-DO Join Latency Budget

**Issue:** dotdo-y6kfh
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates practical latency budgets for cross-DO joins in federated queries. Based on benchmark data and codebase analysis, we establish that **3-5 DOs can participate in a join within 500ms** for same-colo operations, with specific strategies for optimizing different join patterns.

### Success Criteria (from issue)

| Criteria | Target | Result |
|----------|--------|--------|
| Join 10K rows from DO-A with 10K rows from DO-B | <500ms | Achievable with hash join + bloom filter |
| Round-trip latency measurement | Documented | 2-5ms same-colo, 50-150ms cross-colo |
| Define acceptable limits | Complete | See Latency Budget Guidelines below |

## Baseline Latency Measurements

### DO-to-DO RPC Latency

Based on existing benchmark infrastructure in `/benchmarks/perf/network/`:

| Scenario | p50 | p95 | p99 | Notes |
|----------|-----|-----|-----|-------|
| Same-colo DO call | ~2-5ms | ~10ms | ~25ms | Via stub.fetch() |
| Cross-colo DO call | ~50-150ms | ~200ms | ~350ms | Network RTT dependent |
| Worker-to-DO baseline | ~1-3ms | ~5ms | ~15ms | Initial routing |

### Regional Latency Matrix (from `colo-matrix.perf.test.ts`)

| Route | Average p50 |
|-------|-------------|
| Intra-NA | ~10-15ms |
| Intra-EU | ~8-12ms |
| Intra-APAC | ~12-20ms |
| NA <-> EU | ~70-90ms |
| NA <-> APAC | ~120-180ms |
| EU <-> APAC | ~150-200ms |

## Latency Budget for N-Way Joins

### Sequential Join Pattern (Current)

For sequential cross-DO joins where each hop depends on the previous:

```
Total Latency = N * RPC_latency + Processing_overhead
```

| DOs in Join | Same-Colo (p50) | Cross-Colo (p50) | Fits 500ms Budget? |
|-------------|-----------------|------------------|---------------------|
| 2 | ~10ms | ~150ms | Yes |
| 3 | ~15ms | ~300ms | Yes (same-colo only) |
| 5 | ~25ms | ~500ms | Barely (same-colo) |
| 10 | ~50ms | ~1000ms | No |

### Parallel Fan-out Pattern

For queries that can fetch from multiple DOs simultaneously (from `graph-cross-do.perf.test.ts`):

```typescript
// Parallel fanout to 3 DOs - all queries execute concurrently
const [tasks, tools, industries] = await Promise.all([
  ctx.do.list(`/relationships/from/${occupation}?verb=performs`),
  ctx.do.list(`/relationships/from/${occupation}?verb=uses`),
  ctx.do.list(`/relationships/from/${occupation}?verb=employedIn`),
])
```

| Parallel DOs | Same-Colo (p50) | Cross-Colo (p50) | Notes |
|--------------|-----------------|------------------|-------|
| 3 | ~5ms | ~60ms | Limited by slowest |
| 5 | ~8ms | ~80ms | Same as 3 with variance |
| 10 | ~15ms | ~150ms | Tail latency dominates |

**Key Finding:** Parallel fan-out can query **up to 10 DOs within 500ms** even cross-colo.

## Join Strategy Analysis

### 1. Broadcast Join

**When to use:** Small table (< 1000 rows) joining with large table(s) across DOs.

```typescript
// Broadcast small "lookup" data to all participating DOs
const lookupTable = await sourceD0.list('/small-reference-data')

// Execute joins locally at each DO
const results = await Promise.all(
  targetDOs.map(do => do.joinWith(lookupTable))
)
```

| Metric | Value |
|--------|-------|
| Network cost | 1 broadcast + N parallel |
| Latency (5 DOs) | ~10-20ms same-colo |
| Memory per DO | O(broadcast size) |
| Best for | Dimension tables, lookups |

**Recommendation:** Use broadcast join when one side has < 1000 rows.

### 2. Semi-Join (Predicate Pushdown)

**When to use:** Filtering large datasets before joining.

```typescript
// Step 1: Get matching IDs from first DO (filter pushed down)
const matchingIds = await ordersD0.list('/orders', {
  where: { status: 'active' },
  select: ['customerId']  // Only fetch join keys
})

// Step 2: Fetch full data only for matching records
const customers = await customersD0.getBatch(matchingIds.map(o => o.customerId))
```

| Metric | Value |
|--------|-------|
| Network cost | 2 sequential RPCs |
| Data transfer | O(matching keys) + O(matched rows) |
| Latency | ~10-15ms same-colo |
| Best for | Highly selective filters |

**Recommendation:** Use semi-join when selectivity < 10%.

### 3. Hash Join

**When to use:** Large tables without useful indexes.

```typescript
// Build hash table from smaller side
const buildSide = leftStats.rowCount < rightStats.rowCount ? left : right

// Cost model from query-planner.ts
const hashJoinCost = (leftRows + rightRows) * SCAN_COST * 2
```

| Metric | Value |
|--------|-------|
| Build cost | O(smaller table) |
| Probe cost | O(larger table) |
| Memory | O(smaller table) |
| Best for | Equi-joins, no indexes |

The existing `QueryPlanner` in `db/primitives/query-engine/planner/query-planner.ts` already implements hash join selection:

```typescript
// Default to hash join with smaller table on build side
const buildSide = leftStats.rowCount < rightStats.rowCount ? join.left : join.right

return {
  type: 'hash_join',
  buildSide,
  estimatedCost: this.calculateCost({...}),
}
```

### 4. Bloom Filter Pushdown

**When to use:** Reducing data transfer for large joins.

From `benchmarks/perf/iceberg/bloom-filter.perf.test.ts`:

| Operation | Latency | Notes |
|-----------|---------|-------|
| Create bloom (10K items) | ~5-10ms | At 1% FPR |
| Query single item | <1ms | O(k) hash functions |
| Query batch (100 items) | ~2-3ms | Vectorized |
| Serialize/transfer | ~3-5ms | ~10 bits/element |

**Strategy:**
1. Build bloom filter from join keys at source DO
2. Serialize and send to target DO (~10KB for 10K items)
3. Target DO pre-filters using bloom before fetching full data
4. False positives (~1%) are filtered during final join

```typescript
// Bloom filter join pattern
const bloomFilter = await sourceD0.buildBloomFilter('/join-keys', { fpr: 0.01 })
const candidateIds = await targetD0.probeBloom(bloomFilter)  // Fast local filter
const actualMatches = await targetD0.getBatch(candidateIds)  // Only fetch candidates
```

| Metric | Value |
|--------|-------|
| Network savings | Up to 90%+ for sparse joins |
| Latency overhead | ~10-15ms for bloom operations |
| Best for | Joins with < 10% match rate |

## Promise Pipelining (Cap'n Web RPC)

The existing capnweb integration enables **promise pipelining** to hide latency:

From `objects/transport/rpc-server.ts`:

```typescript
// Pipelined call - result can be used before resolution
const userPromise = root.getUser('123')
const postsPromise = userPromise.getPosts()  // Doesn't wait for user resolution
const countPromise = postsPromise.count()    // Chains further

// All resolve in single round-trip
const [user, posts, count] = await Promise.all([userPromise, postsPromise, countPromise])
```

**Latency benefit:**
- Without pipelining: 3 sequential RPCs = ~15ms
- With pipelining: 1 round-trip = ~5ms

**Current limitation:** `maxPipelineDepth: 20` in `RPCServerConfig`

## Recommendations

### 1. Latency Budget Guidelines

| Join Pattern | Max DOs | Target p50 | Strategy |
|--------------|---------|------------|----------|
| Point lookups | 10+ | <50ms | Parallel fan-out |
| 2-way equi-join | 2 | <20ms | Hash join or semi-join |
| 3-way join | 3 | <50ms | Pipelined semi-joins |
| N-way star schema | 5-10 | <100ms | Broadcast dimension tables |
| Graph traversal | 3-5 hops | <150ms | Promise pipelining |

### 2. When to Use Each Strategy

```
Is one side < 1000 rows?
  YES -> Broadcast join
  NO  -> Continue

Is filter selectivity < 10%?
  YES -> Semi-join with predicate pushdown
  NO  -> Continue

Is match rate < 10%?
  YES -> Bloom filter pushdown
  NO  -> Continue

Are inputs sorted on join key?
  YES -> Sort-merge join
  NO  -> Hash join (smaller side as build)
```

### 3. Same-Colo Optimization

For latency-critical joins:

1. **Use locationHint** in DO stub creation to colocate related DOs
2. **Shard by join key** to keep related data in same DO
3. **Cache cross-DO results** with TTL for repeated queries

### 4. Implementation Priorities

1. **Short-term:** Implement parallel fan-out for scatter-gather patterns
2. **Medium-term:** Add bloom filter pushdown to query planner
3. **Long-term:** Full promise pipelining through capnweb protocol

## Transaction Safety for Cross-DO Operations

For cross-DO joins that involve mutations, the codebase provides transaction primitives in `objects/CrossDOTransaction.ts`:

### CrossDOSaga Pattern

For eventual consistency with compensation:

```typescript
import { CrossDOSaga } from './CrossDOTransaction'

const checkout = new CrossDOSaga<Order, Shipment>()
  .addStep({
    name: 'reserveInventory',
    targetDO: 'InventoryDO',
    execute: async (order) => inventoryDO.reserve(order),
    compensate: async (reservation) => inventoryDO.release(reservation),
    timeout: 5000,  // 5s timeout per step
  })
  .addStep({
    name: 'processPayment',
    targetDO: 'PaymentDO',
    execute: async (reservation) => paymentDO.charge(reservation),
    compensate: async (payment) => paymentDO.refund(payment),
  })

const result = await checkout.execute(order, { idempotencyKey: order.id })
```

### Two-Phase Commit

For stronger consistency when atomic operations are required:

```typescript
import { TwoPhaseCommit } from './CrossDOTransaction'

const tpc = new TwoPhaseCommit({ timeout: 30000 })
  .addParticipant({
    id: 'inventory',
    prepare: () => inventoryDO.prepareReservation(),
    commit: () => inventoryDO.commitReservation(),
    rollback: () => inventoryDO.rollbackReservation(),
  })
  .addParticipant({
    id: 'payment',
    prepare: () => paymentDO.validatePayment(),
    commit: () => paymentDO.processPayment(),
    rollback: () => paymentDO.cancelPayment(),
  })

const result = await tpc.execute()
```

### Timeout Handling

All cross-DO calls should use timeout wrappers:

```typescript
import { crossDOCallWithTimeout } from './CrossDOTransaction'

const result = await crossDOCallWithTimeout(
  () => targetDO.fetch('/expensive-query'),
  5000,  // 5s timeout
  'TargetDO'
)
```

## Cost Model Parameters

The `QueryPlanner` uses these cost weights (from `query-planner.ts`):

```typescript
const DEFAULT_COST_MODEL = {
  SCAN_COST: 1,        // Base cost per row scanned
  INDEX_COST: 0.1,     // Cost for index lookup (10x cheaper than scan)
  PARTITION_COST: 10,  // Cost for partition access
  NETWORK_COST: 100,   // Cost for cross-DO network hop
}
```

For cross-DO joins, the **NETWORK_COST** of 100 means a single cross-DO hop is equivalent to scanning 100 rows locally. This drives the optimizer to:

1. Minimize network hops (prefer local joins)
2. Push predicates down to reduce data transfer
3. Use bloom filters to eliminate unnecessary network calls

## Open Questions

1. **Adaptive join selection:** Should we dynamically switch strategies based on runtime statistics?
2. **Cross-region replication:** For global queries, should we replicate dimension tables to each region?
3. **Query compilation:** Can we compile common join patterns to reduce planning overhead?
4. **Timeout propagation:** How should timeouts cascade through multi-hop joins?

## References

### Benchmark Infrastructure
- `benchmarks/perf/datasets/graph/graph-cross-do.perf.test.ts` - Cross-DO graph benchmarks
- `benchmarks/perf/network/colo-matrix.perf.test.ts` - Colo latency matrix
- `benchmarks/perf/network/http-baseline.perf.test.ts` - HTTP baseline measurements
- `benchmarks/perf/iceberg/bloom-filter.perf.test.ts` - Bloom filter performance

### Implementation Code
- `db/primitives/query-engine/planner/query-planner.ts` - Query planner with cost model
- `objects/transport/rpc-server.ts` - RPC server with promise pipelining (maxPipelineDepth: 20)
- `objects/CrossDOTransaction.ts` - Saga and 2PC transaction primitives
- `objects/tests/cross-do-transactions.test.ts` - Transaction safety tests

### Related Documentation
- `db/spikes/consistency-analysis.md` - Consistency guarantees analysis
- Related issue: `dotdo-9n9wc` - FederatedQueryPlanner epic

---

## See Also

### Related Spikes

- [Broadcast Join Strategy](./broadcast-join-strategy.md) - Detailed analysis of broadcast joins without shuffle network
- [Distributed Checkpoint Coordination](./distributed-checkpoint-coordination.md) - Checkpoint coordination using these latency budgets
- [Multi-Tenant Semantic Isolation](./multi-tenant-semantic-isolation.md) - Query performance implications for multi-tenant systems
- [Checkpoint Size Limits](./checkpoint-size-limits.md) - Storage constraints affecting cross-DO state management

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - Cross-DO module patterns

### Spikes Index

- [All Spikes](./README.md) - Complete index of research spikes
