# Replication Guide & Consistency Guarantees

**Version:** 1.0
**Status:** Stable
**Modules:** `leader-follower`, `multi-master`, `conflict-resolver`, `event-subscriber`

## Overview

The unified storage system provides complete replication support for building distributed applications with varying consistency and availability requirements.

## Table of Contents

1. [Why Replication](#why-replication)
2. [Replication Modes](#replication-modes)
3. [Leader-Follower Setup](#leader-follower-setup)
4. [Multi-Master Setup](#multi-master-setup)
5. [Conflict Resolution](#conflict-resolution)
6. [Consistency Guarantees](#consistency-guarantees)
7. [Operations Guide](#operations-guide)
8. [Troubleshooting](#troubleshooting)

---

## Why Replication

Replication enables:

- **Read Scaling**: Distribute read load across multiple replicas
- **Geo-Distribution**: Place data closer to users for lower latency
- **Fault Tolerance**: Survive node failures with automatic failover
- **High Availability**: Continue serving during maintenance or outages

### When to Use Replication

| Scenario | Recommended Mode | Reason |
|----------|-----------------|--------|
| Read-heavy workloads | Leader-Follower | Scale reads while maintaining strong consistency |
| Multi-region writes | Multi-Master | Accept writes at any location |
| High availability | Leader-Follower with failover | Automatic promotion on failure |
| Offline-first apps | Multi-Master with CRDTs | Conflict-free concurrent edits |
| Single writer, many readers | Leader-Follower | Simplest consistency model |
| Collaborative editing | Multi-Master | Low-latency local writes |

---

## Replication Modes

### Comparison Table

| Feature | Leader-Follower | Multi-Master |
|---------|----------------|--------------|
| Write nodes | 1 (leader only) | All nodes |
| Read nodes | All | All |
| Consistency | Strong (leader), Eventual (followers) | Eventual |
| Conflict handling | None (single writer) | Required |
| Failover | Manual or automatic promotion | Built-in (all can write) |
| Latency (writes) | Higher (round-trip to leader) | Lower (local writes) |
| Latency (reads) | Low (local reads) | Low (local reads) |
| Complexity | Lower | Higher |
| Use case | Read scaling, HA | Geo-distribution, offline |

### Architecture Overview

```
                    LEADER-FOLLOWER                      MULTI-MASTER
                    ===============                      ============

                      +--------+                    +--------+    +--------+
                      | Leader |                    |Master 1|<-->|Master 2|
                      +--------+                    +--------+    +--------+
                          |                              ^            ^
              +-----------+-----------+                  |            |
              |           |           |                  +-----+------+
              v           v           v                        |
         +--------+  +--------+  +--------+              +--------+
         |Follower|  |Follower|  |Follower|              |Master 3|
         +--------+  +--------+  +--------+              +--------+

         Writes: Leader only                    Writes: Any master
         Reads: Any node                        Reads: Any master
         Sync: Leader -> Followers              Sync: All <-> All
```

---

## Leader-Follower Setup

### Architecture

```
                              Writes
                                |
                                v
                          +----------+
                          |  Leader  |  Accepts writes, emits events
                          +----------+
                                |
                                v
                          +----------+
                          | Pipeline |  Event distribution
                          +----------+
                                |
              +-----------------+-----------------+
              |                 |                 |
              v                 v                 v
         +----------+      +----------+      +----------+
         |Follower 1|      |Follower 2|      |Follower 3|
         +----------+      +----------+      +----------+
              ^                 ^                 ^
              |                 |                 |
            Reads             Reads             Reads
```

### Configuration Options

```typescript
interface LeaderFollowerConfig {
  nodeId: string                    // Required: Unique node identifier
  role: 'leader' | 'follower'       // Required: Node role
  pipeline: Pipeline                // Required: Event pipeline
  stateStore: StateStore            // Required: Local state storage
  namespace: string                 // Required: Replication namespace
  leaderId?: string                 // Follower: Current leader ID
  heartbeatService?: HeartbeatService  // Optional: Health monitoring
  heartbeatIntervalMs?: number      // Default: 1000
  heartbeatTimeoutMs?: number       // Default: 5000
  maxStalenessMs?: number           // Default: 30000 (30 seconds)
  lastAppliedSequence?: number      // Recovery: Resume from sequence
  promotionEligible?: boolean       // Default: true
}
```

### Starting the Leader

```typescript
import { LeaderFollowerManager, ReplicationRole } from './leader-follower'

// Create leader
const leader = new LeaderFollowerManager({
  nodeId: 'leader-1',
  role: ReplicationRole.Leader,
  pipeline: env.PIPELINE,
  stateStore: sqliteStore,
  namespace: 'tenant-abc',
  heartbeatService: heartbeat,
  heartbeatIntervalMs: 1000,
})

// Start leader
await leader.start()

// Write operations (leader only)
const result = await leader.write({
  key: 'customer-123',
  value: { name: 'Alice', email: 'alice@example.com' },
  operation: 'create',
})

console.log(`Write sequence: ${result.sequence}`)
```

### Starting Followers

```typescript
// Create follower
const follower = new LeaderFollowerManager({
  nodeId: 'follower-1',
  role: ReplicationRole.Follower,
  pipeline: env.PIPELINE,
  stateStore: sqliteStore,
  namespace: 'tenant-abc',
  leaderId: 'leader-1',
  heartbeatService: heartbeat,
  maxStalenessMs: 30000,
  promotionEligible: true,
})

// Start follower - subscribes to Pipeline and catches up
await follower.start()

// Read operations (followers serve reads)
const value = await follower.read('customer-123')
console.log(value) // { name: 'Alice', email: 'alice@example.com' }

// Check staleness
if (follower.isStale()) {
  console.warn('Follower data may be stale')
}
```

### Write Rejection on Followers

```typescript
// Writes on followers are rejected
const result = await follower.write({
  key: 'customer-456',
  value: { name: 'Bob' },
  operation: 'create',
})

if (!result.success) {
  console.log(result.error)     // "Follower is read-only. Redirect to leader."
  console.log(result.errorCode) // "FOLLOWER_READ_ONLY"
  console.log(result.leaderId)  // "leader-1"
}
```

### Failover Process

#### Detecting Leader Failure

```typescript
// Monitor leader health
follower.on('leaderFailed', async ({ leaderId }) => {
  console.log(`Leader ${leaderId} has failed`)

  // Check if this follower can participate in election
  if (follower.canParticipateInElection()) {
    // Implement leader election (e.g., based on sequence, node ID)
    await participateInElection(follower)
  }
})

// Manual health check
if (!follower.isLeaderHealthy()) {
  console.warn('Leader appears unhealthy')
}
```

#### Promoting a Follower

```typescript
// Promote follower to leader
try {
  await follower.promote()

  console.log(`Node ${follower.getNodeId()} is now leader`)
  console.log(`Role: ${follower.getRole()}`)  // 'leader'

  // Can now accept writes
  await follower.write({
    key: 'customer-789',
    value: { name: 'Charlie' },
    operation: 'create',
  })
} catch (error) {
  console.error('Promotion failed:', error.message)
}
```

#### Demoting a Leader

```typescript
// Demote leader to follower (e.g., when original leader recovers)
await leader.demote()

// Now operates as a follower
console.log(leader.getRole())  // 'follower'
```

### Read Routing

```typescript
class ReadRouter {
  private leader: LeaderFollowerManager
  private followers: LeaderFollowerManager[]
  private roundRobinIndex = 0

  // Route reads to followers for load distribution
  async read(key: string, options?: { preferFresh?: boolean }): Promise<unknown> {
    // For fresh data, read from leader
    if (options?.preferFresh) {
      return this.leader.read(key)
    }

    // Filter out stale followers
    const healthyFollowers = this.followers.filter(f => !f.isStale())

    if (healthyFollowers.length === 0) {
      // Fall back to leader if all followers are stale
      return this.leader.read(key)
    }

    // Round-robin across healthy followers
    const follower = healthyFollowers[this.roundRobinIndex % healthyFollowers.length]
    this.roundRobinIndex++

    return follower.read(key)
  }
}
```

### Tracking Replication Lag

```typescript
// Leader: Track follower progress
const leaderState = leader.getLeaderState()

for (const [followerId, info] of leaderState.followers) {
  const lag = leader.getFollowerLag(followerId)
  console.log(`Follower ${followerId}: lag = ${lag} events`)
  console.log(`  Last heartbeat: ${info.lastHeartbeat}`)
  console.log(`  Last sequence: ${info.lastReportedSequence}`)
}

// Follower: Report state
const followerState = follower.getFollowerState()
console.log(`Applied sequence: ${followerState.appliedSequence}`)
console.log(`Is stale: ${followerState.isStale}`)
```

---

## Multi-Master Setup

### Architecture

```
                    +----------+
                    |  Client  |
                    +----------+
                         |
         +---------------+---------------+
         |               |               |
         v               v               v
    +--------+      +--------+      +--------+
    |Master 1|      |Master 2|      |Master 3|   Local writes
    | (US)   |      | (EU)   |      | (APAC) |
    +--------+      +--------+      +--------+
         |               |               |
         +-------+-------+-------+-------+
                 |               |
                 v               v
            +----------+   +----------+
            | Pipeline |   | Pipeline |   Event propagation
            +----------+   +----------+

    Each master:
    - Accepts writes locally
    - Emits events to Pipeline
    - Subscribes to other masters' events
    - Resolves conflicts using vector clocks
```

### Configuration

```typescript
interface MultiMasterConfig {
  masterId: string                      // Required: Unique master ID
  pipeline: Pipeline                    // Required: Event pipeline
  stateManager: StateManager            // Required: Local state storage
  conflictStrategy?: ConflictStrategy   // Default: 'lww'
  mergeFn?: MergeFn                     // Custom merge function
  eventBufferSize?: number              // Default: 1000
  applyTimeout?: number                 // Default: 5000ms
}

type ConflictStrategy = 'lww' | 'custom' | 'manual' | 'detect'
```

### Creating Masters

```typescript
import { MultiMasterManager } from './multi-master'

// Create masters for each region
const usaMaster = new MultiMasterManager({
  masterId: 'master-usa',
  pipeline: usaPipeline,
  stateManager: usaStateManager,
  conflictStrategy: 'lww',
})

const euMaster = new MultiMasterManager({
  masterId: 'master-eu',
  pipeline: euPipeline,
  stateManager: euStateManager,
  conflictStrategy: 'lww',
})

// Subscribe to remote events
await usaMaster.subscribe()
await euMaster.subscribe()
```

### Writing Data

```typescript
// Write locally (low latency)
const result = await usaMaster.write('customer-123', {
  name: 'Alice',
  email: 'alice@example.com',
  region: 'USA',
})

console.log(`Write success: ${result.success}`)
console.log(`Master: ${result.masterId}`)      // 'master-usa'
console.log(`Entity: ${result.entityId}`)      // 'customer-123'
console.log(`Queued: ${result.queued}`)        // false (or true if Pipeline unavailable)

// Concurrent write from another region
await euMaster.write('customer-123', {
  name: 'Alice Smith',           // Changed name
  email: 'alice@example.com',
  region: 'USA',
})

// Both writes are accepted locally
// Conflict resolution happens on event propagation
```

### Vector Clocks Explained

Vector clocks track causality across distributed nodes:

```
Timeline:
=========

USA Master                          EU Master
==========                          =========

Initial: {usa: 0}                   Initial: {eu: 0}

Write A: {usa: 1}  ----event--->    Receive A: {usa: 1, eu: 0}
                                    Merged clock: {usa: 1, eu: 0}

                   <----event----   Write B: {usa: 1, eu: 1}
Receive B: {usa: 1, eu: 1}
Merged clock: {usa: 1, eu: 1}

Write C: {usa: 2, eu: 1}

Comparison Logic:
- A happens-before B if A[node] <= B[node] for all nodes AND A != B
- Concurrent if neither dominates (different nodes increased)
```

```typescript
import { VectorClock } from './multi-master'

// Create clocks
const clockA = new VectorClock({ usa: 1, eu: 0 })
const clockB = new VectorClock({ usa: 0, eu: 1 })
const clockC = new VectorClock({ usa: 1, eu: 1 })

// Compare clocks
VectorClock.compare(clockA, clockB)  // 'concurrent' - different nodes incremented
VectorClock.compare(clockA, clockC)  // 'before' - A happened before C
VectorClock.compare(clockC, clockA)  // 'after' - C happened after A

// Merge clocks (takes max of each component)
const merged = VectorClock.merge(clockA, clockB)
console.log(merged.toJSON())  // { usa: 1, eu: 1 }
```

### Conflict Handling

```typescript
// Detect conflicts
const result = await master.applyRemoteEvent(event)

if (result.isConflict) {
  console.log('Conflict detected!')

  // Get conflict details
  const conflicts = await master.getConflicts()
  for (const conflict of conflicts) {
    console.log(`Entity: ${conflict.entityId}`)
    console.log(`Detected at: ${new Date(conflict.detectedAt)}`)
    console.log(`Versions:`)
    for (const version of conflict.versions) {
      console.log(`  - Master ${version.masterId}:`)
      console.log(`    Data: ${JSON.stringify(version.data)}`)
      console.log(`    Clock: ${JSON.stringify(version.vectorClock)}`)
    }
    console.log(`Options: ${conflict.resolutionOptions.join(', ')}`)
  }
}
```

### Manual Conflict Resolution

```typescript
// Configure manual resolution
const master = new MultiMasterManager({
  masterId: 'master-1',
  pipeline,
  stateManager,
  conflictStrategy: 'manual',
})

// Get pending conflicts
const pending = await master.getPendingConflicts()

for (const conflict of pending) {
  // Resolve based on business logic
  const resolvedData = mergeCustomerData(conflict.versions)

  await master.resolveConflict(conflict.entityId, resolvedData)
}
```

### Geo-Distribution Patterns

#### Regional Masters with LWW

```typescript
// Each region has its own master
const regions = ['us-east', 'us-west', 'eu-west', 'ap-south']

const masters = regions.map(region => new MultiMasterManager({
  masterId: `master-${region}`,
  pipeline: pipelines[region],
  stateManager: stateManagers[region],
  conflictStrategy: 'lww',  // Last-writer-wins by timestamp
}))

// Route writes to nearest region
function routeWrite(userId: string, data: Record<string, unknown>) {
  const userRegion = getUserRegion(userId)
  const master = masters.find(m => m.getMasterId().includes(userRegion))
  return master.write(userId, data)
}
```

#### Active-Active with Custom Merge

```typescript
const master = new MultiMasterManager({
  masterId: 'master-1',
  pipeline,
  stateManager,
  conflictStrategy: 'custom',
  mergeFn: (local, remote) => {
    // Domain-specific merge logic
    return {
      ...remote,
      $id: local.$id,
      $type: local.$type,
      $version: Math.max(local.$version, remote.$version) + 1,
      data: {
        ...local.data,
        ...remote.data,
        // Merge arrays by union
        tags: [...new Set([
          ...(local.data.tags || []),
          ...(remote.data.tags || []),
        ])],
        // Keep higher values for counters
        viewCount: Math.max(
          local.data.viewCount || 0,
          remote.data.viewCount || 0
        ),
      },
      updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    }
  },
})
```

---

## Conflict Resolution

### Available Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `lww` | Last-writer-wins by timestamp | Simple, deterministic |
| `custom` | User-provided merge function | Domain-specific logic |
| `manual` | Queue for human resolution | Critical data |
| `detect` | Detect only, don't resolve | Logging, alerting |

### Last Write Wins (LWW)

```typescript
import { ConflictResolver, LastWriteWinsStrategy } from './conflict-resolver'

const resolver = new ConflictResolver(new LastWriteWinsStrategy())

const result = resolver.resolve(
  { value: { name: 'Alice' }, timestamp: 1000, nodeId: 'node-1' },
  { value: { name: 'Bob' }, timestamp: 2000, nodeId: 'node-2' }
)

console.log(result.value)       // { name: 'Bob' }
console.log(result.resolution)  // 'remote'

// Tiebreaker: If timestamps equal, higher nodeId wins
const tied = resolver.resolve(
  { value: 'A', timestamp: 1000, nodeId: 'node-1' },
  { value: 'B', timestamp: 1000, nodeId: 'node-2' }
)
console.log(tied.value)  // 'B' (node-2 > node-1)
```

### Version Vector Strategy

```typescript
import { VersionVectorStrategy } from './conflict-resolver'

const resolver = new ConflictResolver(new VersionVectorStrategy())

// Causal ordering
const result = resolver.resolve(
  {
    value: { v: 1 },
    timestamp: 1000,
    nodeId: 'A',
    vectorClock: { entries: { A: 1, B: 0 } }
  },
  {
    value: { v: 2 },
    timestamp: 2000,
    nodeId: 'B',
    vectorClock: { entries: { A: 1, B: 1 } }
  }
)

console.log(result.resolution)  // 'remote' (B dominates A)

// Concurrent updates
const concurrent = resolver.resolve(
  {
    value: { v: 1 },
    timestamp: 1000,
    nodeId: 'A',
    vectorClock: { entries: { A: 1, B: 0 } }
  },
  {
    value: { v: 2 },
    timestamp: 1000,
    nodeId: 'B',
    vectorClock: { entries: { A: 0, B: 1 } }
  }
)

console.log(concurrent.resolution)  // 'merged' (concurrent, fell back to LWW)
console.log(concurrent.conflicts)   // Contains both versions
```

### Field Merge Strategy

```typescript
import { FieldMergeStrategy } from './conflict-resolver'

const resolver = new ConflictResolver(new FieldMergeStrategy())

const result = resolver.resolve(
  {
    value: { name: 'Alice', email: 'alice@old.com', age: 30 },
    timestamp: 1000,
    nodeId: 'A'
  },
  {
    value: { name: 'Alice Smith', phone: '555-1234' },
    timestamp: 2000,
    nodeId: 'B'
  }
)

// Fields merged:
// - name: 'Alice Smith' (remote wins, newer timestamp)
// - email: 'alice@old.com' (only in local)
// - age: 30 (only in local)
// - phone: '555-1234' (only in remote)
console.log(result.value)
// { name: 'Alice Smith', email: 'alice@old.com', age: 30, phone: '555-1234' }
```

### CRDT Types

#### GCounter (Grow-only Counter)

```typescript
import { GCounter } from './conflict-resolver'

// Node A
const counterA = new GCounter('node-a')
counterA.increment(5)
console.log(counterA.value())  // 5

// Node B
const counterB = new GCounter('node-b')
counterB.increment(3)
console.log(counterB.value())  // 3

// Merge (commutative, associative, idempotent)
counterA.merge(counterB)
console.log(counterA.value())  // 8 (5 + 3)

// Serialize/deserialize
const json = counterA.toJSON()  // { 'node-a': 5, 'node-b': 3 }
const restored = GCounter.fromJSON(json)
```

#### PNCounter (Positive-Negative Counter)

```typescript
import { PNCounter } from './conflict-resolver'

const counter = new PNCounter('node-a')
counter.increment(10)
counter.decrement(3)
console.log(counter.value())  // 7

// Merge with remote
const remote = new PNCounter('node-b')
remote.increment(5)
remote.decrement(2)

counter.merge(remote)
console.log(counter.value())  // 10 (7 + 3)
```

#### GSet (Grow-only Set)

```typescript
import { GSet } from './conflict-resolver'

const setA = new GSet<string>()
setA.add('apple')
setA.add('banana')

const setB = new GSet<string>()
setB.add('banana')
setB.add('cherry')

// Merge via union
setA.merge(setB)
console.log(setA.elements())  // ['apple', 'banana', 'cherry']
console.log(setA.has('cherry'))  // true
```

#### LWWRegister (Last-Writer-Wins Register)

```typescript
import { LWWRegister } from './conflict-resolver'

const regA = new LWWRegister<string>('node-a')
regA.set('value-1', 1000)

const regB = new LWWRegister<string>('node-b')
regB.set('value-2', 2000)

// Merge (higher timestamp wins)
regA.merge(regB)
console.log(regA.get())        // 'value-2'
console.log(regA.timestamp())  // 2000
```

### CRDT Merge Strategy

```typescript
import { CRDTMergeStrategy, GCounter, PNCounter } from './conflict-resolver'

const resolver = new ConflictResolver(new CRDTMergeStrategy())

// Objects with CRDT fields are merged automatically
const result = resolver.resolve(
  {
    value: {
      views: GCounter.fromJSON({ 'node-a': 100 }),
      likes: PNCounter.fromJSON({ positive: { 'node-a': 50 }, negative: {} }),
      title: 'Original Title',
    },
    timestamp: 1000,
    nodeId: 'A'
  },
  {
    value: {
      views: GCounter.fromJSON({ 'node-b': 75 }),
      likes: PNCounter.fromJSON({ positive: { 'node-b': 30 }, negative: {} }),
      title: 'Updated Title',
    },
    timestamp: 2000,
    nodeId: 'B'
  }
)

// CRDT fields merged, regular fields use LWW
console.log(result.value.views.value())   // 175 (100 + 75)
console.log(result.value.likes.value())   // 80 (50 + 30)
console.log(result.value.title)           // 'Updated Title'
```

### Custom Resolver Functions

```typescript
import { CustomResolverStrategy } from './conflict-resolver'

const resolver = new ConflictResolver(new CustomResolverStrategy((local, remote) => {
  // Business logic: merge shopping cart items
  const localItems = local.value.items || []
  const remoteItems = remote.value.items || []

  // Merge by item ID, sum quantities
  const merged = new Map<string, number>()

  for (const item of localItems) {
    merged.set(item.id, (merged.get(item.id) || 0) + item.qty)
  }
  for (const item of remoteItems) {
    merged.set(item.id, (merged.get(item.id) || 0) + item.qty)
  }

  return {
    value: {
      items: Array.from(merged.entries()).map(([id, qty]) => ({ id, qty })),
    },
    timestamp: Math.max(local.timestamp, remote.timestamp),
    nodeId: remote.nodeId,
    resolution: 'merged',
  }
}))
```

### Best Practices

| Scenario | Recommended Strategy | Reason |
|----------|---------------------|--------|
| User profiles | LWW | Simple, last edit wins |
| Counters (views, likes) | GCounter/PNCounter | No conflicts, always correct |
| Tags, categories | GSet | Union semantics, no data loss |
| Shopping carts | Custom merge | Sum quantities |
| Financial data | Manual | Requires human review |
| Collaborative docs | Field merge + CRDTs | Granular conflict handling |
| Audit logs | GSet | Append-only, no conflicts |

---

## Consistency Guarantees

### Strong Consistency

**Definition:** All nodes see the same data at the same logical time.

**Implementation:** Leader-acknowledged writes.

```typescript
// Configure strong consistency
const leader = new LeaderFollowerManager({
  nodeId: 'leader-1',
  role: ReplicationRole.Leader,
  pipeline,
  stateStore,
  namespace: 'tenant-abc',
})

// Write returns only after leader persistence
const result = await leader.write({
  key: 'account-balance',
  value: { balance: 1000 },
  operation: 'update',
})

// sequence confirms durability
if (result.success) {
  console.log(`Durably written at sequence ${result.sequence}`)
}
```

**Trade-offs:**
- Higher latency (write must reach leader)
- Lower availability (leader failure blocks writes)
- Simpler reasoning (no conflicts)

### Eventual Consistency

**Definition:** All nodes will eventually converge to the same state.

**Implementation:** Async propagation via Pipeline.

```typescript
// Configure eventual consistency
const master = new MultiMasterManager({
  masterId: 'master-1',
  pipeline,
  stateManager,
  conflictStrategy: 'lww',  // Automatic resolution
})

// Write returns immediately (local)
const result = await master.write('user-123', { name: 'Alice' })

// Event propagates asynchronously
// Other masters will eventually receive and apply
```

**Convergence time:**
- Depends on network latency
- Pipeline delivery guarantees
- No upper bound (but typically seconds)

### Read-Your-Writes (Session Consistency)

**Definition:** A client always sees their own writes.

**Implementation:** Track write sequence, route reads appropriately.

```typescript
class SessionConsistentClient {
  private lastWriteSequence = 0
  private leader: LeaderFollowerManager
  private followers: LeaderFollowerManager[]

  async write(key: string, value: unknown): Promise<void> {
    const result = await this.leader.write({ key, value, operation: 'update' })
    if (result.success) {
      this.lastWriteSequence = result.sequence
    }
  }

  async read(key: string): Promise<unknown> {
    // Find a follower that's caught up to our writes
    for (const follower of this.followers) {
      const state = follower.getFollowerState()
      if (state && state.appliedSequence >= this.lastWriteSequence) {
        return follower.read(key)
      }
    }

    // Fall back to leader if no follower is caught up
    return this.leader.read(key)
  }
}
```

### Causal Consistency

**Definition:** Operations that are causally related are seen in the same order by all nodes.

**Implementation:** Vector clocks.

```typescript
// Vector clocks track causality
const master = new MultiMasterManager({
  masterId: 'master-1',
  pipeline,
  stateManager,
  conflictStrategy: 'lww',
})

// Write A
await master.write('entity-1', { step: 1 })
// Vector clock: { master-1: 1 }

// Write B (causally depends on A)
await master.write('entity-1', { step: 2 })
// Vector clock: { master-1: 2 }

// Other masters receive B after A (guaranteed by vector clock ordering)
// Events with lower clock values are applied first
```

### CAP Theorem Trade-offs

```
                    Consistency
                        /\
                       /  \
                      /    \
                     /  CA  \
                    /________\
                   /\        /\
                  /  \  CP  /  \
                 / AP \    /    \
                /______\  /______\
           Availability    Partition
                           Tolerance

Leader-Follower: CP (Consistent + Partition-tolerant)
  - Sacrifices availability during leader failure
  - Maintains consistency

Multi-Master: AP (Available + Partition-tolerant)
  - Sacrifices consistency during partitions
  - Maintains availability
  - Eventual consistency on reconnect
```

| Mode | During Partition | After Partition |
|------|-----------------|-----------------|
| Leader-Follower | Writes blocked | Immediate consistency |
| Multi-Master | Writes continue locally | Conflict resolution |

---

## Operations Guide

### Adding Replicas

#### Adding a Follower

```typescript
// 1. Create new follower
const newFollower = new LeaderFollowerManager({
  nodeId: 'follower-new',
  role: ReplicationRole.Follower,
  pipeline,
  stateStore: newStateStore,
  namespace: 'tenant-abc',
  leaderId: 'leader-1',
  lastAppliedSequence: 0,  // Start from beginning
})

// 2. Start follower (will catch up via Pipeline)
await newFollower.start()

// 3. Monitor catch-up progress
newFollower.on('eventApplied', ({ sequence }) => {
  console.log(`Caught up to sequence ${sequence}`)
})

// 4. Register with leader (optional, for monitoring)
await leader.registerFollower('follower-new')
```

#### Adding a Master

```typescript
// 1. Create new master
const newMaster = new MultiMasterManager({
  masterId: 'master-new',
  pipeline: newPipeline,
  stateManager: newStateManager,
  conflictStrategy: 'lww',
})

// 2. Subscribe to receive events
await newMaster.subscribe()

// 3. Initial sync: replay historical events from Iceberg
// (handled by Pipeline subscription)

// 4. Announce to cluster (emit presence event)
await newMaster.write('_cluster:master-new', {
  status: 'online',
  joinedAt: Date.now(),
})
```

### Removing Replicas

#### Removing a Follower

```typescript
// 1. Unregister from leader
await leader.unregisterFollower('follower-old')

// 2. Stop the follower
await followerOld.close()

// 3. Clean up state store (optional)
await followerOld.stateStore.clear()
```

#### Removing a Master

```typescript
// 1. Announce departure
await masterOld.write('_cluster:master-old', {
  status: 'leaving',
  leftAt: Date.now(),
})

// 2. Drain in-flight writes
await sleep(5000)  // Allow propagation

// 3. Close the master
await masterOld.close()
```

### Monitoring Replication Lag

```typescript
// Leader-Follower: Check lag per follower
const leaderState = leader.getLeaderState()
const metrics = leader.getMetrics()

console.log('=== Replication Metrics ===')
console.log(`Current sequence: ${leaderState.currentSequence}`)
console.log(`Events emitted: ${metrics.eventsEmitted}`)
console.log(`Follower count: ${leaderState.followerCount}`)

for (const [followerId, info] of leaderState.followers) {
  const lag = leaderState.currentSequence - info.lastReportedSequence
  const lastSeen = Date.now() - info.lastHeartbeat

  console.log(`\nFollower: ${followerId}`)
  console.log(`  Lag: ${lag} events`)
  console.log(`  Last seen: ${lastSeen}ms ago`)

  if (lag > 100) {
    console.warn(`  WARNING: High lag detected!`)
  }
}

// Multi-Master: Check event buffer
const masterMetrics = master.getMetrics()

console.log('=== Multi-Master Metrics ===')
console.log(`Local writes: ${masterMetrics.writesLocal}`)
console.log(`Events applied: ${masterMetrics.eventsApplied}`)
console.log(`Conflicts detected: ${masterMetrics.conflictsDetected}`)
console.log(`Event buffer size: ${masterMetrics.eventBufferSize}`)
console.log(`Vector clock nodes: ${masterMetrics.vectorClockNodes}`)

if (masterMetrics.eventBufferSize > 100) {
  console.warn('WARNING: Events buffering (possible network issue)')
}
```

### Handling Network Partitions

#### Leader-Follower During Partition

```typescript
// Followers will detect leader failure
follower.on('leaderFailed', async ({ leaderId }) => {
  console.log(`Partition detected: cannot reach ${leaderId}`)

  // Option 1: Wait for reconnection
  // Option 2: Promote a follower in the partition

  if (shouldPromote(follower)) {
    await follower.promote()
    announceNewLeader(follower.getNodeId())
  }
})

// After partition heals
async function handlePartitionHealed(oldLeader: LeaderFollowerManager, newLeader: LeaderFollowerManager) {
  // Compare sequences
  const oldSeq = oldLeader.getLeaderState()?.currentSequence || 0
  const newSeq = newLeader.getLeaderState()?.currentSequence || 0

  if (newSeq > oldSeq) {
    // New leader has more data - demote old
    await oldLeader.demote()
  } else {
    // Old leader has more data - demote new, replay
    await newLeader.demote()
  }
}
```

#### Multi-Master During Partition

```typescript
// Masters continue accepting writes during partition
// Conflicts will be resolved when partition heals

master.on('conflictDetected', async (conflict) => {
  console.log(`Conflict during partition healing: ${conflict.entityId}`)

  // Automatic resolution if strategy is set
  // Or queue for manual resolution

  if (master.getConflictStrategy() === 'manual') {
    notifyAdminOfConflict(conflict)
  }
})
```

### Recovery Procedures

#### Recovering a Follower

```typescript
// Follower with corrupted state
const recoveredFollower = new LeaderFollowerManager({
  nodeId: 'follower-recovered',
  role: ReplicationRole.Follower,
  pipeline,
  stateStore: freshStateStore,
  namespace: 'tenant-abc',
  leaderId: 'leader-1',
  lastAppliedSequence: 0,  // Replay from beginning
})

await recoveredFollower.start()

// Monitor full replay
recoveredFollower.on('eventApplied', ({ sequence }) => {
  const leaderSeq = leader.getLeaderState()?.currentSequence || 0
  const progress = (sequence / leaderSeq * 100).toFixed(1)
  console.log(`Recovery progress: ${progress}%`)
})
```

#### Recovering a Master

```typescript
// Master rejoining after being offline
const recoveredMaster = new MultiMasterManager({
  masterId: 'master-recovered',
  pipeline,
  stateManager: recoveredStateManager,
  conflictStrategy: 'lww',
  eventBufferSize: 10000,  // Larger buffer for catch-up
})

await recoveredMaster.subscribe()

// Monitor catch-up
setInterval(() => {
  const metrics = recoveredMaster.getMetrics()
  console.log(`Catch-up: ${metrics.eventsApplied} events applied`)
  console.log(`Buffer: ${metrics.eventBufferSize} events pending`)
}, 1000)
```

---

## Troubleshooting

### High Replication Lag

**Symptoms:**
- Followers report high lag
- Stale reads on followers
- `isStale()` returns true

**Diagnosis:**

```typescript
// Check leader metrics
const leaderMetrics = leader.getMetrics()
console.log(`Events emitted: ${leaderMetrics.eventsEmitted}`)

// Check follower metrics
const followerMetrics = follower.getMetrics()
console.log(`Events applied: ${followerMetrics.eventsApplied}`)

// Check lag per follower
for (const [id, info] of leader.getLeaderState()!.followers) {
  console.log(`${id}: lag = ${leader.getFollowerLag(id)}`)
}

// Check Pipeline health
// (external monitoring)
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Slow Pipeline | Check Pipeline quotas, scale up |
| Network latency | Deploy followers closer to leader |
| Large events | Enable batching, compress payloads |
| Slow follower | Scale follower resources |
| Too many followers | Add intermediate relay nodes |

### Conflict Storms

**Symptoms:**
- High conflict detection rate
- Frequent LWW reversions
- Data oscillating between values

**Diagnosis:**

```typescript
const metrics = master.getMetrics()
const conflictRate = metrics.conflictsDetected / metrics.eventsApplied

console.log(`Conflict rate: ${(conflictRate * 100).toFixed(2)}%`)

if (conflictRate > 0.1) {
  console.warn('High conflict rate detected!')

  // Analyze conflict patterns
  const conflicts = await master.getConflicts()
  const byEntity = new Map<string, number>()

  for (const conflict of conflicts) {
    const count = byEntity.get(conflict.entityId) || 0
    byEntity.set(conflict.entityId, count + 1)
  }

  // Find hot spots
  const sorted = [...byEntity.entries()].sort((a, b) => b[1] - a[1])
  console.log('Hot entities:', sorted.slice(0, 10))
}
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| Hot key contention | Partition data differently |
| Frequent updates | Use CRDTs for mergeable data |
| Short update cycles | Increase update coalescing |
| Incorrect routing | Fix routing to same master |
| LWW timestamp skew | Use logical clocks |

### Split-Brain Scenarios

**Symptoms:**
- Multiple nodes think they're leader
- Divergent data on different nodes
- Conflicting writes accepted

**Diagnosis:**

```typescript
// Check all nodes claiming leadership
const leaders = nodes.filter(n => n.getRole() === 'leader')

if (leaders.length > 1) {
  console.error('SPLIT BRAIN DETECTED!')

  for (const leader of leaders) {
    console.log(`Leader: ${leader.getNodeId()}`)
    console.log(`  Sequence: ${leader.getLeaderState()?.currentSequence}`)
    console.log(`  Followers: ${leader.getConnectedFollowers().join(', ')}`)
  }
}
```

**Resolution:**

```typescript
async function resolveSplitBrain(leaders: LeaderFollowerManager[]) {
  // 1. Compare sequences - highest wins
  const sorted = leaders.sort((a, b) => {
    const seqA = a.getLeaderState()?.currentSequence || 0
    const seqB = b.getLeaderState()?.currentSequence || 0
    return seqB - seqA
  })

  const winner = sorted[0]
  const losers = sorted.slice(1)

  console.log(`Winner: ${winner.getNodeId()}`)

  // 2. Demote losers
  for (const loser of losers) {
    console.log(`Demoting: ${loser.getNodeId()}`)
    await loser.demote()
  }

  // 3. Losers will catch up via Pipeline
}
```

**Prevention:**

1. Use proper leader election with fencing tokens
2. Implement heartbeat with reasonable timeout
3. Use quorum-based leader election
4. Add network partition detection

### Clock Drift Issues

**Symptoms:**
- LWW producing unexpected results
- Future timestamps in events
- Inconsistent ordering

**Diagnosis:**

```typescript
// Check for clock drift
const now = Date.now()

for (const master of masters) {
  const clock = master.getVectorClock()
  const metrics = master.getMetrics()

  // Sample recent events
  const entity = await master.getEntity('test-entity')
  if (entity) {
    const drift = now - entity.updatedAt
    if (Math.abs(drift) > 60000) {  // More than 1 minute
      console.warn(`Clock drift on ${master.getMasterId()}: ${drift}ms`)
    }
  }
}
```

**Solutions:**

| Cause | Solution |
|-------|----------|
| System clock drift | Enable NTP synchronization |
| Timezone issues | Use UTC everywhere |
| Inconsistent timestamps | Use logical clocks (Lamport/Vector) |
| Future timestamps | Reject events with future timestamps |

**Implement clock validation:**

```typescript
function validateEventTimestamp(event: WriteEvent): boolean {
  const now = Date.now()
  const maxDrift = 60000  // 1 minute

  if (event.timestamp > now + maxDrift) {
    console.error(`Future timestamp rejected: ${event.timestamp}`)
    return false
  }

  if (event.timestamp < now - (24 * 60 * 60 * 1000)) {
    console.warn(`Old timestamp: ${event.timestamp}`)
    // May still accept, but log
  }

  return true
}
```

---

## Quick Reference

### LeaderFollowerManager Configuration

```typescript
interface LeaderFollowerConfig {
  nodeId: string                       // Required: Unique node identifier
  role: 'leader' | 'follower'          // Required: Node role
  pipeline: Pipeline                   // Required: Event pipeline
  stateStore: StateStore               // Required: Local state storage
  namespace: string                    // Required: Replication namespace
  leaderId?: string                    // Follower: Current leader ID
  heartbeatService?: HeartbeatService  // Optional: Health monitoring
  heartbeatIntervalMs?: number         // Default: 1000
  heartbeatTimeoutMs?: number          // Default: 5000
  maxStalenessMs?: number              // Default: 30000
  lastAppliedSequence?: number         // Recovery: Resume sequence
  promotionEligible?: boolean          // Default: true
}
```

### MultiMasterManager Configuration

```typescript
interface MultiMasterConfig {
  masterId: string                     // Required: Unique master ID
  pipeline: Pipeline                   // Required: Event pipeline
  stateManager: StateManager           // Required: Local state storage
  conflictStrategy?: ConflictStrategy  // Default: 'lww'
  mergeFn?: MergeFn                    // Custom merge function
  eventBufferSize?: number             // Default: 1000
  applyTimeout?: number                // Default: 5000ms
}

type ConflictStrategy = 'lww' | 'custom' | 'manual' | 'detect'
```

### EventSubscriber Configuration

```typescript
interface EventSubscriberConfig {
  namespace: string                    // Required: Namespace identifier
  checkpointStore: CheckpointStore     // Required: Offset persistence
  onEvent?: (event) => void            // Event callback
  onBatch?: (events) => void           // Batch callback
  onError?: (error, event?) => void    // Error callback
  batchSize?: number                   // Default: 100
  pollInterval?: number                // Default: 1000ms
  checkpointMode?: CheckpointMode      // Default: 'auto'
  checkpointInterval?: number          // Default: 5000ms
  enableIdempotency?: boolean          // Default: false
  idempotencyWindowMs?: number         // Default: 60000ms
  maxRetries?: number                  // Default: 3
  retryDelay?: number                  // Default: 100ms
}

type CheckpointMode = 'auto' | 'manual' | 'interval'
```

### ConflictResolver Strategies

```typescript
import {
  ConflictResolver,
  LastWriteWinsStrategy,
  VersionVectorStrategy,
  FieldMergeStrategy,
  CRDTMergeStrategy,
  CustomResolverStrategy,
} from './conflict-resolver'

// LWW
new ConflictResolver(new LastWriteWinsStrategy())

// Version Vector
new ConflictResolver(new VersionVectorStrategy())

// Field Merge
new ConflictResolver(new FieldMergeStrategy())

// CRDT Merge
new ConflictResolver(new CRDTMergeStrategy())

// Custom
new ConflictResolver(new CustomResolverStrategy((local, remote) => {
  // Custom logic
  return { ...remote, resolution: 'custom' }
}))
```

---

## See Also

- [Sharding Guide](./sharding-guide.md) - Horizontal scaling
- [WebSocket Protocol Spec](./ws-protocol-spec.md) - Real-time protocol
- [leader-follower.ts](../leader-follower.ts) - Leader-follower implementation
- [multi-master.ts](../multi-master.ts) - Multi-master implementation
- [conflict-resolver.ts](../../db/primitives/conflict-resolver.ts) - Conflict resolution
- [event-subscriber.ts](../event-subscriber.ts) - Event subscription
- [pipeline-emitter.ts](../pipeline-emitter.ts) - Event emission
