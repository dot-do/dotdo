# Chaos Testing Runbook

This document provides comprehensive guidance for chaos testing in dotdo's distributed Durable Object infrastructure. Chaos testing validates system correctness under failure conditions, inspired by [Jepsen](https://jepsen.io/) methodology.

## Table of Contents

1. [Philosophy and Goals](#philosophy-and-goals)
2. [Architecture Overview](#architecture-overview)
3. [Available Scenarios](#available-scenarios)
4. [Environment Setup](#environment-setup)
5. [Runbook: Executing Chaos Tests](#runbook-executing-chaos-tests)
6. [Expected Behavior and Recovery](#expected-behavior-and-recovery)
7. [Metrics and Observability](#metrics-and-observability)
8. [Best Practices](#best-practices)

---

## Philosophy and Goals

### Why Chaos Testing?

Distributed systems fail in complex, often unpredictable ways. Traditional unit tests verify happy-path behavior, but chaos testing validates:

- **Durability**: Committed data survives failures
- **Consistency**: System reaches correct state after recovery
- **Availability**: System remains (partially) available during failures
- **Recovery Time**: System recovers within acceptable bounds

### Core Principles

1. **Test in Production-Like Conditions**: Use real miniflare instances, not mocks
2. **Automate Recovery Verification**: Every failure scenario must verify recovery
3. **Measure, Don't Assume**: Track metrics during chaos (latency, data loss, consistency)
4. **Start Small, Escalate**: Begin with single-node failures before multi-node scenarios

### Key Properties Validated

| Property | Description | Assertion Type |
|----------|-------------|----------------|
| `data_integrity` | All data is consistent and uncorrupted | `true` |
| `no_data_loss` | No committed data was lost | `true` |
| `eventual_consistency` | System reached consistent state | `true` |
| `linearizability` | Operations appear in correct order | `true` |
| `durability` | Committed writes persist across failures | `true` |
| `recovery_time` | Recovery within N milliseconds | `lessThan` |

---

## Architecture Overview

### Components

```
                    +------------------+
                    | ChaosController  |
                    +--------+---------+
                             |
        +--------------------+--------------------+
        |                    |                    |
+-------v-------+   +--------v--------+   +-------v-------+
| Network       |   | DO Crash        |   | Pipeline      |
| Partition     |   | Manager         |   | Backpressure  |
| Manager       |   |                 |   | Manager       |
+---------------+   +-----------------+   +---------------+
```

### Key Files

| File | Purpose |
|------|---------|
| `/types/Chaos.ts` | Type definitions for all chaos constructs |
| `/tests/mocks/chaos.ts` | Mock implementations for unit testing |
| `/objects/unified-storage/chaos-controller.ts` | Production chaos injection framework |
| `/objects/unified-storage/partition-recovery.ts` | Network partition recovery manager |
| `/tests/unified-storage/chaos/*.test.ts` | Chaos test suites |

---

## Available Scenarios

### 1. Network Partition

Simulates network splits between nodes.

**Types:**
- `full`: Complete isolation between partitioned nodes
- `partial`: Probabilistic message delivery
- `asymmetric`: One-way partition (A can reach B, B cannot reach A)

**Behavior Options:**
- `drop`: Silently drop messages
- `timeout`: Delay until timeout
- `error`: Return network error immediately

**Configuration:**
```typescript
const partitionConfig: NetworkPartitionConfig = {
  type: 'full',
  affectedNodes: ['follower-1', 'follower-2'],
  duration: 10000, // 10 seconds, undefined = permanent
  behavior: {
    requestHandling: 'drop',
    successRate: 0.0, // For partial partitions
  }
}
```

### 2. Durable Object Crash

Simulates DO crashes with various recovery modes.

**Crash Types:**
- `immediate`: Instant crash, no cleanup
- `graceful`: Clean shutdown with WAL flush
- `oom`: Out-of-memory simulation
- `infinite_loop`: CPU exhaustion simulation

**State Preservation:**
- `none`: All in-memory state lost
- `partial`: Some state preserved (simulates incomplete checkpoint)
- `full`: All state preserved via WAL

**Configuration:**
```typescript
const crashConfig: DOCrashConfig = {
  targetNs: 'tenant-1',
  crashType: 'immediate',
  autoRestart: true,
  restartDelay: 500,
  statePreservation: 'full',
  beforeCrash: async () => {
    // Setup pre-crash assertions
  },
  afterRestart: async () => {
    // Verify recovery
  }
}
```

### 3. Pipeline Backpressure

Simulates event pipeline congestion.

**Intensity Levels:**
- `light`: 10% slowdown
- `moderate`: 50% slowdown
- `severe`: 90% slowdown
- `complete`: Pipeline blocked entirely

**Queue Behavior:**
- `drop_oldest`: Evict oldest queued events
- `drop_newest`: Reject new events
- `reject`: Return errors to callers
- `block`: Block callers until space available

**Configuration:**
```typescript
const backpressureConfig: BackpressureConfig = {
  pipeline: 'EVENTS_PIPELINE',
  intensity: 'severe',
  duration: 5000,
  queueBehavior: {
    maxQueueSize: 100,
    onQueueFull: 'drop_oldest',
    blockTimeoutMs: 1000
  },
  rateLimit: {
    maxEventsPerSecond: 10,
    burstSize: 5
  }
}
```

### 4. SQLite Fault Injection

Simulates database failures.

**Fault Types:**
- `SQLITE_BUSY`: Database locked
- `SQLITE_CORRUPT`: Disk corruption
- `SQLITE_IOERR`: I/O errors
- `latency`: Slow queries

**Scoped Injection:**
```typescript
chaosController.injectFault('sql.exec', {
  type: 'error',
  error: new Error('SQLITE_BUSY'),
  scope: {
    pattern: /^INSERT|^UPDATE/i, // Only affect writes
    tables: ['events', 'actions'], // Specific tables
  },
  probability: 0.3, // 30% failure rate
})
```

### 5. Clock Skew

Simulates time synchronization issues.

**Types:**
- `clock-skew`: Fixed offset (+/- milliseconds)
- `clock-drift`: Gradual drift over time

**Configuration:**
```typescript
chaosController.injectFault('clock.skew', {
  type: 'clock-skew',
  offsetMs: 60000, // 1 minute forward
})

chaosController.injectFault('clock.skew', {
  type: 'clock-drift',
  driftRateMs: 10, // Drift 10ms per second
})
```

### 6. DO Eviction/Hibernation

Simulates Cloudflare's DO hibernation.

**Configuration:**
```typescript
chaosController.injectFault('do.eviction', {
  type: 'eviction',
  coldStartDelayMs: 500, // Cold start latency
  intervalMs: 10000, // Evict every 10 seconds
})
```

---

## Environment Setup

### Prerequisites

```bash
# Install dependencies
npm install

# Ensure vitest is available
npx vitest --version
```

### Running Chaos Tests

```bash
# All chaos tests
npx vitest run tests/unified-storage/chaos/

# Specific scenario
npx vitest run tests/unified-storage/chaos/partition-recovery.test.ts
npx vitest run tests/unified-storage/chaos/pipeline-failure.test.ts
npx vitest run tests/unified-storage/chaos/idempotency-recovery.test.ts

# With verbose output
npx vitest run tests/unified-storage/chaos/ --reporter=verbose

# Watch mode for development
npx vitest tests/unified-storage/chaos/partition-recovery.test.ts
```

### Creating Custom Chaos Scenarios

```typescript
import { ChaosController } from '../objects/unified-storage/chaos-controller'
import { createMockPipeline, createMockSqlStorage } from '../tests/mocks/chaos'

// Setup
const pipeline = createMockPipeline()
const sqlStorage = createMockSqlStorage()

const chaos = new ChaosController({
  pipeline,
  sqlStorage,
  namespace: 'test-tenant',
  enabled: true,
  seed: 12345, // Reproducible randomness
})

// Apply preset
chaos.applyPreset('network-instability')

// Or custom faults
chaos.injectFault('pipeline.send', {
  type: 'latency-then-error',
  delayMs: 200,
  error: new Error('Timeout after delay'),
})

// Execute workload
const wrappedPipeline = chaos.wrapPipeline(pipeline)
await wrappedPipeline.send([{ event: 'test' }])

// Verify
const stats = chaos.getStats()
console.log(`Faults triggered: ${stats.totalFaultsTriggered}`)

// Cleanup
await chaos.close()
```

---

## Runbook: Executing Chaos Tests

### Scenario 1: Leader-Follower Partition Recovery

**Objective**: Verify followers catch up after network partition heals.

**Steps:**

1. **Setup**: Initialize leader and follower DOs
   ```bash
   npx vitest run tests/unified-storage/chaos/partition-recovery.test.ts \
     -t "Follower catches up after partition heals"
   ```

2. **Create Partition**: Isolate follower from leader
   ```typescript
   mockPipeline.partitionNode('follower-node')
   ```

3. **Generate Writes**: Leader processes writes during partition
   ```typescript
   await leader.write({ key: 'item-2', value: { id: 2 } })
   await leader.write({ key: 'item-3', value: { id: 3 } })
   ```

4. **Heal Partition**: Restore connectivity
   ```typescript
   mockPipeline.healNode('follower-node')
   await follower.requestCatchUp()
   ```

5. **Verify Recovery**:
   - Follower received all missed events
   - State matches leader exactly
   - Event order preserved

**Expected Outcome:**
- Follower replication lag returns to 0
- All entities present on follower
- `recoveryComplete` event emitted

---

### Scenario 2: Split-Brain Prevention

**Objective**: Verify only one leader exists during partition.

**Steps:**

1. **Setup**: Create cluster with 1 leader, 2 followers

2. **Partition Leader**: Isolate leader from followers
   ```typescript
   mockPipeline.partitionNode('leader-node')
   mockHeartbeat.simulateTimeout('leader-node')
   ```

3. **Wait for Election Timeout**: Followers detect leader failure

4. **Verify No Split-Brain**:
   - At most 1 node claims leadership
   - Followers require quorum for promotion
   - Fencing tokens prevent stale leader writes

5. **Heal and Reconcile**:
   - Old leader detects new leader
   - Old leader steps down to follower role
   - State synchronized

**Expected Outcome:**
- `countLeaders() <= 1` at all times
- Stale leader writes rejected with `STALE_LEADER` error

---

### Scenario 3: Pipeline Failure Resilience

**Objective**: Verify zero data loss during pipeline outage.

**Steps:**

1. **Setup**: Initialize PipelineEmitter with retry config
   ```typescript
   emitter = new PipelineEmitter(mockPipeline, {
     maxRetries: 10,
     retryDelay: 100,
   })
   ```

2. **Trigger Pipeline Failure**:
   ```typescript
   mockPipeline.setDown(true)
   ```

3. **Generate Events During Outage**:
   ```typescript
   for (let i = 0; i < 100; i++) {
     emitter.emit('thing.created', 'things', { $id: `thing-${i}` })
   }
   ```

4. **Verify Buffering**:
   - Events queued in retry buffer
   - No events sent to failed pipeline
   - Health status shows `degraded`

5. **Restore Pipeline**:
   ```typescript
   mockPipeline.restore()
   await vi.advanceTimersByTimeAsync(1000)
   ```

6. **Verify Recovery**:
   - All 100 events delivered
   - FIFO order preserved
   - Health status returns to `healthy`

**Expected Outcome:**
- `mockPipeline.events.length === 100`
- Retry queue empty after recovery
- No data loss reported

---

### Scenario 4: CRDT Convergence After Partition

**Objective**: Verify CRDTs converge after concurrent writes.

**Steps:**

1. **Setup**: Initialize multi-master with CRDT conflict strategy

2. **Create Partition**:
   ```typescript
   mockPipeline.createGlobalPartition()
   ```

3. **Concurrent Writes**:
   ```typescript
   // Master A increments counter
   await masterA.incrementCounter('page-views', 15)

   // Master B also increments
   await masterB.incrementCounter('page-views', 23)
   ```

4. **Heal and Sync**:
   ```typescript
   mockPipeline.healGlobalPartition()
   await masterA.syncWithRemote()
   await masterB.syncWithRemote()
   ```

5. **Verify Convergence**:
   - Both masters report same counter value
   - Value equals sum of all increments (38)

**Expected Outcome:**
- `counterA === counterB === 38`
- No conflicts reported
- Automatic merge without user intervention

---

### Scenario 5: Idempotent Recovery

**Objective**: Verify duplicate events are deduplicated during cold start.

**Steps:**

1. **Create Duplicate Events in Iceberg**:
   ```typescript
   const events = [
     { idempotencyKey: 'same-key', payload: { id: 1 } },
     { idempotencyKey: 'same-key', payload: { id: 1 } }, // Duplicate
   ]
   ```

2. **Execute Cold Start Recovery**:
   ```typescript
   const result = await recovery.recover()
   ```

3. **Verify Deduplication**:
   - Only 1 entity created
   - `eventsReplayed === 1`
   - No version inflation

**Expected Outcome:**
- Duplicate detection via idempotency key
- Memory-efficient tracking (bloom filter for large sets)
- `duplicatesSkipped` metric reported

---

## Expected Behavior and Recovery

### Recovery Strategies

| Failure Type | Recovery Strategy | Expected Time |
|--------------|-------------------|---------------|
| Network Partition | Automatic reconnection with exponential backoff | < 30s |
| DO Crash | WAL replay on cold start | < 500ms |
| Pipeline Backpressure | Queue drain on capacity restoration | Proportional to queue |
| SQLite Corruption | Checkpoint restore from last good state | < 5s |
| Clock Skew | LWW-Register/G-Counter convergence | < 1s after sync |

### Data Durability Guarantees

1. **Committed writes never lost**: Events that receive `ack` are durable
2. **At-least-once delivery**: Events may be delivered multiple times (dedupe via idempotency)
3. **Eventual consistency**: All replicas converge given connectivity

### Failure Detection Timeouts

| Component | Detection Timeout | Configurable |
|-----------|-------------------|--------------|
| Heartbeat | 3-5 seconds | `heartbeatTimeoutMs` |
| Pipeline Send | 30 seconds | `sendTimeoutMs` |
| SQLite Transaction | 5 seconds | `transactionTimeoutMs` |
| Client Reconnect | 60 seconds max | `maxReconnectAttempts` |

---

## Metrics and Observability

### ChaosController Stats

```typescript
const stats = chaosController.getStats()

// stats.totalFaultsTriggered: Total faults across all targets
// stats.faultsTriggered: Map<target, count>
// stats.activeFaults: Currently active fault count
// stats.createdAt: Controller creation timestamp
```

### Partition Metrics

```typescript
const metrics = partitionManager.getPartitionMetrics()

// metrics.isPartitioned: Current partition state
// metrics.partitionDurationMs: Current partition duration
// metrics.queuedOperations: Pending remote operations
// metrics.localOperationsServed: Reads served locally during partition
// metrics.totalPartitionCount: Historical partition count
// metrics.recoveryAttempts/Successes/Failures: Recovery stats
```

### Buffer Metrics

```typescript
const bufferMetrics = partitionManager.getBufferMetrics()

// bufferMetrics.bufferedCount: Events currently buffered
// bufferMetrics.oldestEventAge: Age of oldest buffered event
// bufferMetrics.bufferUtilization: Percentage of buffer used
// bufferMetrics.eventsDiscardedDueToTimeout: Events expired before send
```

### Health Check Integration

```typescript
emitter.on('healthChange', (status) => {
  // status: 'healthy' | 'degraded'
  // Integrate with Cloudflare health checks
})

const healthDetails = emitter.getHealthDetails()
// healthDetails.retryQueueSize
// healthDetails.consecutiveFailures
// healthDetails.lastError
// healthDetails.degradedSinceMs
```

---

## Best Practices

### 1. Use Seeded Randomness for Reproducibility

```typescript
const chaos = new ChaosController({
  pipeline,
  sqlStorage,
  seed: 12345, // Same seed = same failure sequence
})
```

### 2. Always Clean Up After Tests

```typescript
afterEach(async () => {
  await chaosController.close()
  vi.useRealTimers()
})
```

### 3. Test Combinations of Failures

```typescript
// Network partition + Pipeline backpressure
chaos.injectFault('pipeline.send', { type: 'latency', delayMs: 5000 })
mockPipeline.partitionNode('follower-1')
```

### 4. Verify Both Positive and Negative Assertions

```typescript
// Positive: Data eventually consistent
expect(followerState).toEqual(leaderState)

// Negative: No split-brain occurred
expect(countLeaders()).toBeLessThanOrEqual(1)
```

### 5. Use Realistic Timeouts

```typescript
// Production-like timeouts
const config = {
  heartbeatTimeoutMs: 5000, // Not 10ms
  retryDelay: 1000, // Not 1ms
  maxRetries: 3, // Not 100
}
```

### 6. Document Failure Modes

Each chaos test should document:
- What failure is simulated
- What behavior is expected
- What the recovery path is
- What metrics validate success

### 7. Presets for Common Scenarios

```typescript
// Use built-in presets for consistency
chaos.applyPreset('network-instability')
chaos.applyPreset('sql-instability')
chaos.applyPreset('eviction-stress')
```

---

## Related Documentation

- [Unified Storage Architecture](/docs/architecture/unified-storage.md)
- [Geo-Replication](/docs/architecture/geo-replication.mdx)
- [Error Handling](/docs/workflows/error-handling.mdx)
- [ACID Test Suite Design](/docs/internal/plans/2026-01-09-acid-test-suite-design.md)

---

## References

- [Jepsen: Distributed Systems Safety Analysis](https://jepsen.io/)
- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
