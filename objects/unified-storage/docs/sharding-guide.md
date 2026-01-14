# Sharding Guide & Operational Runbook

**Version:** 1.0
**Status:** Stable
**Modules:** `shard-router`, `shard-assigner`, `cross-shard-query`, `shard-migration`

## Overview

The unified storage system provides complete horizontal scaling through sharding. This guide covers architecture, configuration, and operational procedures.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Partition Key Selection](#partition-key-selection)
3. [Routing Strategies](#routing-strategies)
4. [Operations Runbook](#operations-runbook)
5. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Why Sharding?

Sharding enables:

- **Horizontal Scaling**: Distribute load across multiple Durable Objects
- **Geo-Distribution**: Colocate data with users for lower latency
- **Cost Optimization**: Stay within per-DO memory limits
- **Isolation**: Tenant isolation for multi-tenant applications

### Core Components

```
                    Request
                       |
                       v
               +---------------+
               | ShardRouter   |  Routes by partition key
               +---------------+
                       |
       +---------------+---------------+
       |               |               |
       v               v               v
   +-------+       +-------+       +-------+
   | DO-0  |       | DO-1  |       | DO-2  |   Durable Objects
   +-------+       +-------+       +-------+
       |               |               |
       +---------------+---------------+
                       |
                       v
               +---------------+
               | Pipeline      |  Fire-and-forget events
               +---------------+
                       |
                       v
               +---------------+
               | Iceberg       |  Analytical storage
               +---------------+
                       |
                       v
               +---------------+
               | CrossShardQuery |  Global queries
               +---------------+
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **ShardRouter** | Routes requests to correct DO based on partition key |
| **ShardAssigner** | Determines shard assignment using configurable strategies |
| **CrossShardQuery** | Executes queries across all shards via Iceberg |
| **ShardMigration** | Handles topology changes with zero-downtime |
| **PipelineEmitter** | Sends events to Pipeline (enables event replay for migrations) |

### How Pipeline Enables Zero-Coordination Sharding

The Pipeline-as-WAL architecture is the key to seamless sharding:

```typescript
// Events flow: DO -> Pipeline -> Iceberg
// This means:
// 1. All state changes are captured as events
// 2. Events are stored durably in Iceberg
// 3. Migrations replay events to new shards
// 4. No coordination between DOs needed
```

**Benefits:**

1. **Event Replay**: When adding/removing shards, replay events from Iceberg
2. **Consistent State**: Events are idempotent with idempotency keys
3. **Zero Coordination**: DOs operate independently; Pipeline handles durability
4. **Analytical Queries**: CrossShardQuery reads from Iceberg, not DOs

---

## Partition Key Selection

### Best Practices

**Choose keys with:**

| Property | Why | Example |
|----------|-----|---------|
| High Cardinality | Even distribution | User ID, Order ID |
| Stable | Avoid re-routing | Tenant ID (not status) |
| Query Affinity | Related data together | Customer ID for orders |
| Natural Grouping | Transactions in same shard | Account ID |

### Common Patterns

#### Tenant-Based (Multi-tenant SaaS)

```typescript
const assigner = new ShardAssigner({
  shardCount: 16,
  strategy: 'tenant',
  partitionKey: 'tenantId',
})

// All tenant data in same shard
// Great for: Multi-tenant apps, isolation requirements
```

#### Entity-Based (High-volume Entities)

```typescript
const assigner = new ShardAssigner({
  shardCount: 64,
  strategy: 'hash',
  partitionKey: '$id',
})

// Each entity can land anywhere
// Great for: High-volume independent entities
```

#### Composite Keys (Hierarchical Data)

```typescript
const assigner = new ShardAssigner({
  shardCount: 32,
  strategy: 'hash',
  partitionKey: ['tenantId', 'region'],
})

// Combines multiple fields
// Great for: Regional data, multi-dimensional partitioning
```

#### Custom Extraction (Complex Logic)

```typescript
const assigner = new ShardAssigner({
  shardCount: 16,
  strategy: 'hash',
  partitionKeyFn: (thing) => {
    // Custom logic: use parent for child entities
    if (thing.$type === 'OrderItem') {
      return thing.orderId
    }
    return thing.$id
  },
})
```

### Anti-Patterns

| Anti-Pattern | Problem | Better Alternative |
|--------------|---------|-------------------|
| Timestamp | Hot spots on recent shard | Entity ID |
| Sequential IDs | Uneven distribution | UUIDs or hashed IDs |
| Low-cardinality fields | Few shards get all traffic | Composite keys |
| Mutable fields | Re-routing on updates | Immutable identifiers |
| Null/optional fields | Undefined behavior | Required fields with fallback |

### Handling Missing Keys

```typescript
const assigner = new ShardAssigner({
  shardCount: 8,
  strategy: 'hash',
  partitionKey: 'customerId',
  fallbackKey: '$id',        // Use $id if customerId missing
  strict: false,             // Don't throw on missing keys
})
```

---

## Routing Strategies

### Hash-Based Routing

**Best for:** General purpose, even distribution

```typescript
const router = new ShardRouter({
  namespace: env.DO,
  shardCount: 16,
  strategy: 'hash',
})

// Simple modulo hash
// Pros: Fast, even distribution
// Cons: Adding shards redistributes ~(n-1)/n data
```

**How it works:**

```
partitionKey -> hash(key) -> hash % shardCount -> shardIndex
```

**Distribution characteristics:**

- FNV-1a hash for speed
- Uniform distribution for random keys
- ~6% of requests to each shard with 16 shards

### Consistent Hash Routing

**Best for:** Dynamic shard counts, minimal redistribution

```typescript
const router = new ShardRouter({
  namespace: env.DO,
  shardCount: 16,
  strategy: 'consistent-hash',
  virtualNodes: 150,  // More = better distribution
})

// Only ~1/n data moves when adding a shard
// Pros: Minimal redistribution
// Cons: Slightly higher memory for ring
```

**How it works:**

```
           Hash Ring
         /          \
      vn1            vn2    <- Virtual nodes
       |              |
    +-----+        +-----+
    | DO-0|        | DO-1|
    +-----+        +-----+
       |              |
      vn3            vn4

Key hashes to position on ring
Clockwise to nearest virtual node
Virtual node maps to physical shard
```

**Virtual nodes impact:**

| Virtual Nodes | Distribution Variance | Memory |
|---------------|----------------------|--------|
| 50 | ~15% | Low |
| 100 | ~8% | Medium |
| 150 | ~5% | Medium |
| 500 | ~2% | High |

### Range-Based Routing

**Best for:** Time-series data, alphabetic partitioning

```typescript
const router = new ShardRouter({
  namespace: env.DO,
  strategy: 'range',
  ranges: [
    { start: 'A', end: 'H', shard: 0 },
    { start: 'H', end: 'P', shard: 1 },
    { start: 'P', end: 'Z', shard: 2 },
  ],
  defaultShard: 0,
  comparator: (key) => key.charAt(0).toUpperCase(),
})

// Pros: Predictable routing, range queries
// Cons: Manual tuning, potential hot spots
```

**Time-series example:**

```typescript
const router = new ShardRouter({
  namespace: env.DO,
  strategy: 'range',
  ranges: [
    { start: 0, end: 1704067200000, shard: 0 },    // 2024 Q1
    { start: 1704067200000, end: 1711929600000, shard: 1 }, // 2024 Q2
    { start: 1711929600000, end: Infinity, shard: 2 },      // 2024 Q3+
  ],
  comparator: (key) => parseInt(key.split('-')[1], 10), // Extract timestamp
})
```

### Strategy Comparison

| Strategy | Distribution | Add Shard Impact | Use Case |
|----------|-------------|-----------------|----------|
| Hash | Excellent | Redistributes ~(n-1)/n | Static shard count |
| Consistent Hash | Good | Redistributes ~1/n | Dynamic scaling |
| Range | Manual | None (manual rebalance) | Time-series, alpha |

---

## Operations Runbook

### Adding a Shard

#### Planning

```typescript
const migration = new ShardMigration({
  router,
  iceberg: icebergReader,
  timeout: 300_000,  // 5 minutes
  rollbackOnFailure: true,
})

// 1. Generate migration plan
const plan = await migration.planAddShard('shard-16')
console.log(`Will move ${plan.partitionKeysToMove.length} partition keys`)
console.log(`Estimated duration: ${plan.estimatedDuration}ms`)

// 2. Validate plan
const validation = await migration.validatePlan(plan)
if (!validation.valid) {
  console.error('Plan errors:', validation.errors)
  return
}
```

#### Execution

```typescript
// 3. Create the new shard stub
const newShard: ShardStub = {
  id: 'shard-16',
  // ... implement ShardStub interface
}

// 4. Execute migration
const result = await migration.addShard(newShard, {
  rebalance: true,
  partitionKeys: plan.partitionKeysToMove,
})

if (result.success) {
  console.log(`Added shard-16`)
  console.log(`Events replayed: ${result.eventsReplayed}`)
  console.log(`Duration: ${result.durationMs}ms`)
} else {
  console.error(`Migration failed, rolled back: ${result.rolledBack}`)
}
```

#### Verification

```bash
# Check shard distribution
const stats = await router.getShardStats()
for (const stat of stats) {
  console.log(`${stat.shardId}: ${stat.entityCount} entities, ${stat.memoryBytes} bytes`)
}

# Verify routing works
const testKey = 'test-partition-key'
const shardInfo = router.getShardInfo(testKey)
console.log(`Key routes to: ${shardInfo.shardName}`)
```

### Removing a Shard

#### Pre-removal Checks

```typescript
// 1. Check what will be migrated
const plan = await migration.planRemoveShard('shard-15')
console.log(`Will migrate ${plan.partitionKeysToMove.length} partition keys`)
console.log(`Data destinations:`, plan.dataDestinations)

// 2. Validate
const validation = await migration.validatePlan(plan)
if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings)
}
```

#### Execution

```typescript
// 3. Remove shard (migrates data automatically)
const result = await migration.removeShard('shard-15')

if (result.success) {
  console.log(`Removed shard-15`)
  console.log(`Entities migrated: ${result.entitiesMigrated}`)
} else {
  console.error(`Removal failed`)
}
```

### Rebalancing Data

#### Analyze Balance

```typescript
const analysis = await migration.analyzeBalance()

console.log(`Balanced: ${analysis.isBalanced}`)
console.log(`Imbalance ratio: ${(analysis.imbalanceRatio * 100).toFixed(1)}%`)
console.log(`Hot shards: ${analysis.hotShards.join(', ')}`)
console.log(`Cold shards: ${analysis.coldShards.join(', ')}`)
console.log(`Average entities: ${analysis.avgEntityCount.toFixed(0)}`)
```

#### Execute Rebalance

```typescript
// 1. Generate rebalance plan
const plan = await migration.generateRebalancePlan()

console.log(`Planned movements: ${plan.movements?.length}`)
console.log(`Estimated data to move: ${plan.estimatedDataMoved} bytes`)
console.log(`Total data: ${plan.totalData} bytes`)
console.log(`Movement ratio: ${((plan.estimatedDataMoved / plan.totalData) * 100).toFixed(1)}%`)

// 2. Execute rebalance
const result = await migration.rebalance({
  partitionKeys: plan.partitionKeysToMove,
  targetShards: Object.values(plan.dataDestinations),
})

console.log(`Rebalance complete: ${result.entitiesMoved} entities moved`)
```

### Monitoring Hot Spots

#### Using ShardAssigner

```typescript
const assigner = new ShardAssigner({
  shardCount: 16,
  strategy: 'hash',
  partitionKey: '$id',
  trackAccess: true,
  trackMetadata: true,
  maxEntitiesPerShard: 10_000,
})

// Record accesses
assigner.recordAccess('customer-123', 'read')
assigner.recordAccess('customer-123', 'write')

// Check for hot shards
const hotShards = assigner.getHotShards({
  threshold: 1000,      // 1000 accesses
  windowMs: 60_000,     // in last minute
})

if (hotShards.length > 0) {
  console.warn(`Hot shards detected: ${hotShards.join(', ')}`)
}
```

#### Using ShardRouter Metrics

```typescript
const router = new ShardRouter({
  namespace: env.DO,
  shardCount: 16,
  strategy: 'hash',
  enableMetrics: true,
})

// After some operations...
const metrics = router.getMetrics()

console.log(`Routing operations: ${metrics.routingOperations}`)
console.log(`Forward operations: ${metrics.forwardOperations}`)
console.log(`Average latency: ${metrics.averageLatencyMs.toFixed(2)}ms`)
console.log(`Errors: ${metrics.errorCount}`)

// Check distribution
console.log('Shard distribution:')
for (const [shardIndex, count] of metrics.shardDistribution) {
  const percentage = (count / metrics.routingOperations * 100).toFixed(1)
  console.log(`  Shard ${shardIndex}: ${count} (${percentage}%)`)
}
```

#### Automatic Rebalance Hints

```typescript
const assigner = new ShardAssigner({
  shardCount: 8,
  strategy: 'hash',
  trackMetadata: true,
  maxEntitiesPerShard: 10_000,
  maxBytesPerShard: 100 * 1024 * 1024, // 100MB
  minEntitiesPerShard: 100,
})

// Get rebalance recommendations
const hints = assigner.getRebalanceHints()

for (const hint of hints) {
  console.log(`[${hint.priority}] ${hint.type} shard ${hint.sourceShardId}`)
  console.log(`  Reason: ${hint.reason}`)
  if (hint.targetShardId !== undefined) {
    console.log(`  Target: shard ${hint.targetShardId}`)
  }
  if (hint.migrationPlan) {
    console.log(`  Entities to move: ${hint.migrationPlan.entitiesToMove}`)
    console.log(`  Estimated duration: ${hint.migrationPlan.estimatedDuration}ms`)
  }
}
```

---

## Troubleshooting

### Hot Shard Detection

**Symptoms:**
- High latency on specific operations
- Uneven DO resource usage
- Timeout errors for certain keys

**Diagnosis:**

```typescript
// 1. Check shard distribution
const metrics = router.getMetrics()
const total = metrics.routingOperations
const expected = total / router.getConfig().shardCount

for (const [shard, count] of metrics.shardDistribution) {
  const ratio = count / expected
  if (ratio > 1.5) {
    console.warn(`Hot shard ${shard}: ${(ratio * 100).toFixed(0)}% of expected`)
  }
}

// 2. Check utilization
const utilization = assigner.getShardUtilization()
for (const [shardId, util] of utilization) {
  if (util.entityUtilization > 0.8 || util.byteUtilization > 0.8) {
    console.warn(`Shard ${shardId} at ${(util.entityUtilization * 100).toFixed(0)}% entity / ${(util.byteUtilization * 100).toFixed(0)}% byte utilization`)
  }
}
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Bad partition key | Choose higher-cardinality key |
| Power-law distribution | Add more shards |
| Single hot tenant | Tenant-specific sharding |
| Time-based hot spot | Range-based with rotation |

### Cross-Shard Query Performance

**Symptoms:**
- Slow global queries
- Query timeouts
- High Iceberg scan costs

**Diagnosis:**

```typescript
const result = await crossShardQuery.queryThings({
  type: 'Customer',
  namespace: 'tenant-123',
})

console.log(`Query stats:`)
console.log(`  Shards queried: ${result.stats.shardsQueried}`)
console.log(`  Partitions scanned: ${result.stats.partitionsScanned}`)
console.log(`  Files scanned: ${result.stats.filesScanned}`)
console.log(`  Bytes scanned: ${result.stats.bytesScanned}`)
console.log(`  Partitions pruned: ${result.stats.partitionsPruned}`)
console.log(`  Cache hit: ${result.stats.cacheHit}`)
```

**Solutions:**

| Issue | Solution |
|-------|----------|
| No partition pruning | Add namespace filter to queries |
| Large result sets | Add limit/offset pagination |
| Repeated queries | Enable query caching |
| Slow aggregations | Pre-aggregate in Pipeline |

**Enable caching:**

```typescript
const query = new CrossShardQuery({
  iceberg: icebergReader,
  cacheEnabled: true,
  cacheTTL: 60_000,      // 1 minute
  cacheMaxSize: 100,     // 100 queries
})
```

### Migration Issues

#### Migration Timeout

**Symptoms:**
- `Migration timeout` error
- Partial data migration

**Diagnosis:**

```typescript
const migration = new ShardMigration({
  router,
  iceberg,
  timeout: 300_000,
  onProgress: (progress) => {
    console.log(`Phase: ${progress.phase}`)
    console.log(`Events: ${progress.eventsProcessed}/${progress.totalEvents}`)
    console.log(`Keys: ${progress.partitionKeysProcessed}/${progress.totalPartitionKeys}`)
    console.log(`Elapsed: ${progress.elapsedMs}ms`)
  },
})
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Too much data | Increase timeout |
| Slow Iceberg | Batch smaller migrations |
| Network issues | Enable retry with backoff |

#### Concurrent Migration Conflict

**Symptoms:**
- `Partition key X is already migrating` error

**Diagnosis:**

```typescript
// Check if migration is in progress
if (migration.isMigrating()) {
  console.log('Migration already in progress')
  return
}
```

**Solution:** Wait for current migration to complete, or use different partition keys.

#### Rollback After Failure

**Symptoms:**
- Migration reports `rolledBack: true`

**Diagnosis:**

```typescript
const result = await migration.addShard(newShard, { rebalance: true })

if (result.rolledBack) {
  console.error('Migration failed and was rolled back')
  console.error('Error:', result.error)
}
```

**Solutions:**

1. Check Iceberg connectivity
2. Verify shard stub implementation
3. Check for event apply errors
4. Review migration logs

### Write Buffer During Migration

**Symptoms:**
- Writes appear lost during migration
- Eventual consistency delays

**How it works:**

```typescript
// During migration, writes to migrating keys are buffered
migration.bufferWrite({
  type: 'thing.updated',
  entityId: 'customer-123',
  partitionKey: 'tenant-abc',
  // ...
})

// After migration, buffered writes are applied
// Result includes: bufferedWrites: N
```

**Best practices:**

1. Keep migrations short
2. Monitor buffer size
3. Use idempotent operations
4. Test with realistic write load

---

## Quick Reference

### ShardRouter Configuration

```typescript
interface ShardRouterConfig {
  namespace: DurableObjectNamespace  // Required: DO binding
  shardCount?: number                // Required for hash/consistent-hash
  strategy: 'hash' | 'consistent-hash' | 'range'
  virtualNodes?: number              // Default: 100 (for consistent-hash)
  ranges?: RangeDefinition[]         // Required for range strategy
  defaultShard?: number              // Default: 0
  shardNamePrefix?: string           // Default: 'shard-'
  retryConfig?: RetryConfig          // Optional retry settings
  addRoutingHeaders?: boolean        // Default: false
  enableMetrics?: boolean            // Default: false
}
```

### ShardAssigner Configuration

```typescript
interface ShardAssignerConfig {
  shardCount: number                 // Required
  strategy: 'hash' | 'consistent' | 'range' | 'tenant'
  partitionKey?: string | string[]   // Default: '$id'
  fallbackKey?: string               // Fallback if primary missing
  strict?: boolean                   // Throw on missing key
  partitionKeyFn?: (thing) => string // Custom extraction
  trackMetadata?: boolean            // Track entity counts
  trackAccess?: boolean              // Track access patterns
  maxEntitiesPerShard?: number       // Trigger split hint
  maxBytesPerShard?: number          // Trigger split hint
  minEntitiesPerShard?: number       // Trigger merge hint
  virtualNodes?: number              // Default: 150 (for consistent)
}
```

### CrossShardQuery Configuration

```typescript
interface CrossShardQueryConfig {
  iceberg: IcebergReader             // Required: Iceberg reader
  timeout?: number                   // Default: 30000ms
  cacheEnabled?: boolean             // Default: false
  cacheTTL?: number                  // Default: 60000ms
  cacheMaxSize?: number              // Default: 100
}
```

### ShardMigration Configuration

```typescript
interface ShardMigrationConfig {
  router: ShardRouter                // Required
  iceberg: IcebergReader             // Required
  timeout?: number                   // Default: 60000ms
  batchSize?: number                 // Default: 100
  rollbackOnFailure?: boolean        // Default: false
  onProgress?: (progress) => void    // Progress callback
  writeBuffer?: WriteBuffer          // External write buffer
}
```

---

## See Also

- [WebSocket Protocol Spec](./ws-protocol-spec.md) - Real-time protocol
- [shard-router.ts](../shard-router.ts) - Router implementation
- [shard-assigner.ts](../shard-assigner.ts) - Assigner implementation
- [cross-shard-query.ts](../cross-shard-query.ts) - Query implementation
- [shard-migration.ts](../shard-migration.ts) - Migration implementation
- [pipeline-emitter.ts](../pipeline-emitter.ts) - Event emission
