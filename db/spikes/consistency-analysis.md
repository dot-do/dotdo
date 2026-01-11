# Cross-Node Consistency Analysis for Stateless DOs

## Problem Statement

Cloudflare Durable Objects (DOs) provide a **single-instance guarantee**: one location, one instance at any given time. This guarantee is fundamental to their consistency model - there is no coordination needed because there is only ever one writer.

When we move to **stateless DOs** (DOs that can run on any node with state externalized to libSQL/Turso + Iceberg), we lose this guarantee. Multiple nodes could potentially serve requests for the same DO simultaneously, leading to:

1. **Split-brain scenarios**: Two nodes both believing they are the active instance
2. **Concurrent write conflicts**: Lost updates, inconsistent state
3. **Stale reads**: Reading from outdated replicas
4. **Session affinity loss**: Mid-operation routing changes

## Current Architecture Analysis

### Cloudflare DO Single-Instance Guarantee

Cloudflare achieves single-instance through:

1. **Global routing layer**: Anycast routing with DO ID -> location mapping
2. **DO placement**: Consistent hashing pins DO ID to a specific location (colo)
3. **In-memory state**: State lives in memory of the hosting isolate
4. **Storage binding**: Each DO has exclusive access to its storage binding
5. **Location hints**: Can suggest placement but cannot guarantee multi-location

Key insight: **The single-instance guarantee is a consequence of the architecture, not an explicit lock.**

### dotdo's Current Implementation

From the codebase analysis:

```typescript
// DOFull.ts - Already has sophisticated lifecycle management
- Two-phase commit (2PC) for staged clones
- Clone locks for resumable operations
- Circuit breakers for cross-DO calls
- Eventual consistency replication
```

The existing `CloneLockState` interface already models the locking concept:

```typescript
interface CloneLockState {
  lockId: string
  cloneId: string
  target: string
  acquiredAt: Date
  expiresAt: Date
  isStale: boolean
}
```

## Consistency Options Analysis

### Option A: Distributed Lock (Redis/DynamoDB)

**Architecture:**
```
Request → Router → Acquire Lock(doId) → Serve DO → Release Lock
                        ↓
              Lock Service (Redis/DynamoDB)
```

**Implementation:**
```typescript
interface ConsistencyGuard {
  acquire(doId: string, ttlMs: number): Promise<Lock>
  release(lock: Lock): Promise<void>
  refresh(lock: Lock): Promise<Lock>
  isAvailable(doId: string): Promise<boolean>
}
```

**Latency Analysis:**
| Operation | Latency | Notes |
|-----------|---------|-------|
| Lock acquire | 5-20ms | Single RTT to lock service |
| Lock refresh | 5-20ms | Periodic during request |
| Lock release | 5-20ms | Can be async (fire-and-forget) |

**Failure Modes:**
| Failure | Impact | Mitigation |
|---------|--------|------------|
| Lock service down | All DOs unavailable | Multi-region lock service, circuit breaker |
| Node crash holding lock | Lock held until TTL expires | Short TTL + heartbeat |
| Network partition | Split brain possible | Fencing tokens |
| Lock contention | High latency | Backoff, jitter |

**Complexity Assessment:**
- New infrastructure dependency
- TTL tuning critical (too short = false release, too long = availability hit)
- Fencing tokens needed to prevent stale locks acting on state

**Recommendation: VIABLE but adds latency and dependency**

---

### Option B: Turso/libSQL Leader-Follower

**Architecture:**
```
Request → Router → Any Node → Query libSQL
                        ↓
              ┌─────────┴─────────┐
              │   libSQL Leader   │ ← Writes
              └─────────┬─────────┘
                        │ Replication
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    Replica 1       Replica 2       Replica N
        ↑               ↑               ↑
     Reads          Reads           Reads
```

**How libSQL Replication Works:**

libSQL uses a WAL-based replication protocol:
1. **Primary (leader)** handles all writes
2. **Replicas** receive WAL frames asynchronously
3. **Frame-level consistency**: Each frame is checksummed
4. **Read-your-writes**: Can be achieved with frame tracking

From `packages/turso/src/sync.ts`:
```typescript
interface Frame {
  frameNo: number      // Monotonic
  pageNo: number       // SQLite page
  data: Uint8Array     // Page content
  checksum: number     // Integrity
  timestamp: number    // Origin time
}
```

**Consistency Guarantees:**
| Mode | Guarantee | Latency |
|------|-----------|---------|
| Strong (read leader) | Linearizable | Higher (always hit leader) |
| Read-your-writes | Causal consistency | Medium (track frame position) |
| Eventual | Eventual consistency | Low (any replica) |

**Latency Analysis:**
| Operation | Latency | Notes |
|-----------|---------|-------|
| Write (to leader) | 2-10ms | Depends on leader location |
| Read (local replica) | <1ms | No network if co-located |
| Read (read-your-writes) | 2-10ms | May need to wait for replication |

**Failure Modes:**
| Failure | Impact | Mitigation |
|---------|--------|------------|
| Leader down | Writes blocked until failover | Automatic leader election |
| Replica lag | Stale reads | Frame position tracking |
| Network partition | Split brain during failover | Quorum-based election |

**Key Insight: libSQL already solves the write coordination problem!**

The single-writer model is enforced by having a single leader. This maps well to our needs:
- Each DO's data lives in a logical database
- Only the leader can write
- Reads can go to any replica with appropriate consistency mode

**Complexity Assessment:**
- No new infrastructure (using Turso/libSQL we already integrate)
- Configuration complexity: replica placement, read consistency modes
- Need to handle leader failover gracefully

**Recommendation: STRONG - Leverages existing infrastructure**

---

### Option C: Routing Affinity (Consistent Hashing)

**Architecture:**
```
Request(doId) → Consistent Hash Ring → Specific Node → Serve DO
                        ↓
              Node 1 ─────── Node 2 ─────── Node 3
                │             │              │
              DO A,D        DO B,E         DO C,F
```

**Implementation:**
```typescript
class ConsistentHashRouter {
  private ring: HashRing

  route(doId: string): NodeId {
    return this.ring.getNode(doId)
  }

  addNode(node: NodeId): void {
    this.ring.add(node)
  }

  removeNode(node: NodeId): void {
    this.ring.remove(node)
  }
}
```

**Latency Analysis:**
| Operation | Latency | Notes |
|-----------|---------|-------|
| Hash calculation | <0.1ms | Pure computation |
| Route lookup | <1ms | In-memory hash ring |
| Request routing | Variable | Depends on node location |

**Failure Modes:**
| Failure | Impact | Mitigation |
|---------|--------|------------|
| Node failure | DOs migrate to new node | Virtual nodes reduce churn |
| Membership changes | Potential for brief inconsistency | Handoff protocol needed |
| Stale routing | Two nodes serving same DO | Gossip protocol for membership |
| Split brain | Nodes disagree on membership | External consensus (etcd/consul) |

**The Hidden Problem:**

Consistent hashing alone doesn't prevent split-brain during membership changes:
1. Node A fails
2. Load balancer 1 routes DO to Node B
3. Load balancer 2 (hasn't seen failure) routes DO to Node A (now recovered)
4. Both nodes serve the same DO

You need an external membership service, which brings us back to distributed coordination.

**Complexity Assessment:**
- Requires membership coordination (gossip or consensus)
- Virtual nodes add complexity but improve balance
- Handoff protocol needed for clean transitions

**Recommendation: NOT SUFFICIENT ALONE - needs coordination layer**

---

### Option D: Optimistic Concurrency Control (OCC)

**Architecture:**
```
Request → Any Node → Read State (with version) → Process → Write (with version check)
                                                              ↓
                                                    Conflict? → Retry with new version
```

**Implementation:**
```typescript
interface VersionedState<T> {
  data: T
  version: number  // Or vector clock
  timestamp: number
}

async function updateWithOCC<T>(
  doId: string,
  update: (state: T) => T
): Promise<T> {
  let retries = 0
  while (retries < MAX_RETRIES) {
    const current = await read(doId)
    const newState = update(current.data)
    try {
      await write(doId, newState, current.version)
      return newState
    } catch (e) {
      if (e instanceof VersionConflict) {
        retries++
        continue
      }
      throw e
    }
  }
  throw new MaxRetriesExceeded()
}
```

**Latency Analysis:**
| Operation | Latency | Notes |
|-----------|---------|-------|
| Read | 2-10ms | Standard read |
| Write (no conflict) | 2-10ms | Standard write |
| Write (with conflict) | N * write latency | Retry loop |

**Failure Modes:**
| Failure | Impact | Mitigation |
|---------|--------|------------|
| High contention | Retry storms, high latency | Exponential backoff, jitter |
| Long transactions | High conflict rate | Keep transactions short |
| Starvation | Some writes never succeed | Priority queuing, fairness |
| Version overflow | Need version rollover | Use timestamps or UUIDs |

**When OCC Works Well:**
- Low contention (rare concurrent writes to same DO)
- Short transactions
- Idempotent operations
- Read-heavy workloads

**When OCC Fails:**
- High contention (many writers to same DO)
- Long-running operations
- Non-idempotent operations

**Complexity Assessment:**
- Application must handle retry logic
- Idempotency requirements
- Cannot prevent long-lived split brain (both nodes succeed at different times)

**Recommendation: COMPLEMENTARY - good for low-contention, but not sole solution**

---

## Hybrid Approach: Recommended Architecture

After analyzing all options, the optimal solution is a **hybrid approach** that combines:

1. **libSQL Leader-Follower** (Option B) for write coordination
2. **Routing Affinity** (Option C) for performance optimization
3. **Optimistic Concurrency** (Option D) for additional safety

### Architecture

```
                              ┌──────────────────┐
                              │   Load Balancer  │
                              │ (Any-cast global)│
                              └────────┬─────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────▼─────┐      ┌─────▼─────┐     ┌─────▼─────┐
              │  Worker   │      │  Worker   │     │  Worker   │
              │  Node 1   │      │  Node 2   │     │  Node 3   │
              └─────┬─────┘      └─────┬─────┘     └─────┬─────┘
                    │                  │                  │
                    │   Consistent Hash Ring (Hint)       │
                    │                  │                  │
              ┌─────▼─────────────────▼──────────────────▼─────┐
              │              libSQL/Turso                       │
              │  ┌─────────────────────────────────────────┐   │
              │  │              Leader (Primary)            │   │
              │  │  - All writes go here                   │   │
              │  │  - Single-writer guarantee              │   │
              │  └─────────────────┬───────────────────────┘   │
              │                    │ WAL Replication           │
              │  ┌─────────────────┼───────────────────┐       │
              │  │                 │                   │       │
              │  ▼                 ▼                   ▼       │
              │ Replica 1      Replica 2          Replica N    │
              │ (edge)         (edge)             (edge)       │
              └────────────────────────────────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │     Iceberg     │
                              │  (S3/R2 cold)   │
                              └─────────────────┘
```

### Consistency Guard Implementation

```typescript
interface ConsistencyGuard {
  // Acquire exclusive access to DO (hints to route to optimal node)
  acquire(doId: string): Promise<Lock>

  // Release exclusive access
  release(lock: Lock): Promise<void>

  // Check if DO is available for serving
  isAvailable(doId: string): Promise<boolean>

  // Get optimal node for this DO (affinity hint)
  getAffinityNode(doId: string): NodeId
}

class HybridConsistencyGuard implements ConsistencyGuard {
  private hashRing: ConsistentHashRing  // For affinity
  private libsql: LibSQLClient           // For coordination

  async acquire(doId: string): Promise<Lock> {
    // 1. Calculate affinity node (for optimization)
    const affinityNode = this.hashRing.getNode(doId)

    // 2. Acquire logical lock in libSQL leader
    // This uses libSQL's single-writer guarantee
    const lock = await this.libsql.execute({
      sql: `INSERT INTO do_locks (do_id, node_id, acquired_at, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (do_id) DO UPDATE
            SET node_id = excluded.node_id,
                acquired_at = excluded.acquired_at,
                expires_at = excluded.expires_at
            WHERE expires_at < CURRENT_TIMESTAMP`,
      args: [doId, affinityNode, Date.now(), Date.now() + TTL]
    })

    return {
      doId,
      nodeId: affinityNode,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + TTL,
      version: lock.lastInsertRowid
    }
  }

  async release(lock: Lock): Promise<void> {
    await this.libsql.execute({
      sql: `DELETE FROM do_locks WHERE do_id = ? AND version = ?`,
      args: [lock.doId, lock.version]
    })
  }

  async isAvailable(doId: string): Promise<boolean> {
    const result = await this.libsql.execute({
      sql: `SELECT * FROM do_locks WHERE do_id = ? AND expires_at > ?`,
      args: [doId, Date.now()]
    })
    return result.rows.length === 0
  }

  getAffinityNode(doId: string): NodeId {
    return this.hashRing.getNode(doId)
  }
}
```

### Why This Works

1. **Single-writer via libSQL**: All lock acquisitions go through libSQL's leader, which is inherently single-writer. No split-brain possible.

2. **Routing affinity for performance**: Consistent hashing hints help requests for the same DO go to the same worker, improving cache hit rates.

3. **No external lock service**: We use libSQL itself as the coordination mechanism, avoiding new dependencies.

4. **Graceful degradation**: If libSQL leader is unavailable, we fail fast rather than risk split-brain.

5. **Edge-local reads**: Read replicas at the edge minimize latency for read-heavy workloads.

## Performance Comparison

| Approach | Write Latency | Read Latency | Availability | Complexity |
|----------|--------------|--------------|--------------|------------|
| CF DO (baseline) | <1ms | <1ms | High | Low |
| Distributed Lock | +20ms | 0 | Medium | Medium |
| libSQL Leader | +5ms | 0-5ms | High | Low |
| Consistent Hash | 0 | 0 | Medium* | Medium |
| OCC | 0-100ms** | 0 | High | Low |
| **Hybrid (recommended)** | +5ms | 0-2ms | High | Medium |

*Without coordination, availability degrades during membership changes
**Highly variable under contention

## Trade-offs

### What We Gain
- Ability to run DOs on any node (true stateless)
- Cold start elimination (no isolate warm-up needed)
- Cheaper operations (no DO instantiation overhead)
- Better failure handling (state survives node crashes)

### What We Lose
- Sub-millisecond write latency (adds ~5ms for leader write)
- Zero-coordination model (now need lock round-trip)
- Simplicity of single-location guarantee

### When to Use Stateless vs Traditional DOs

| Use Stateless DOs When | Use Traditional DOs When |
|------------------------|--------------------------|
| Read-heavy workload | Write-heavy workload |
| Large number of cold DOs | Small number of hot DOs |
| Need cross-region replication | Single-region is sufficient |
| Cost sensitivity | Latency sensitivity |
| Long-lived state | Ephemeral state |

## Next Steps

1. **Implement POC** (`consistency-poc.ts`) with:
   - HybridConsistencyGuard class
   - Lock table schema
   - Integration with existing DOBase

2. **Failure scenario testing**:
   - Node crash during write
   - Network partition
   - Lock expiry race conditions
   - Concurrent lock acquisition

3. **Performance benchmarking**:
   - Compare with traditional DOs
   - Measure lock overhead
   - Test under various contention levels
