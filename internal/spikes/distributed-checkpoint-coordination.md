# Distributed Checkpoint Coordination Across DOs

**Issue:** dotdo-woo4p
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates distributed checkpoint coordination strategies for streaming systems built on Durable Objects. The core challenge: coordinating checkpoints across multiple independent DOs acting as stream operators to achieve consistent global snapshots for exactly-once processing and fault recovery.

### Key Findings

| Finding | Recommendation |
|---------|----------------|
| Chandy-Lamport adapted for DOs | Use marker-based barriers with FIFO channel simulation |
| Aligned vs Unaligned | Start with aligned; add unaligned for backpressure scenarios |
| Coordinator placement | Dedicated CheckpointCoordinatorDO per dataflow |
| Recovery strategy | Two-phase: restore from R2 snapshots + replay WAL |
| Latency budget | <100ms for 5-DO checkpoint coordination (same-colo) |

### Success Criteria

| Criteria | Target | Feasibility |
|----------|--------|-------------|
| Coordinate checkpoint across 10 DOs | <500ms | Achievable with parallel barrier injection |
| Exactly-once recovery | Guaranteed | Via epoch-based deduplication |
| Handle DO restart during checkpoint | Graceful | Via checkpoint timeout + retry |
| In-flight message handling | Complete | Via channel state capture |

## Background: Chandy-Lamport Algorithm

The [Chandy-Lamport algorithm](https://en.wikipedia.org/wiki/Chandy%E2%80%93Lamport_algorithm) (1985) captures consistent global snapshots of distributed systems without halting computation.

### Algorithm Overview

1. **Initiator** records local state and sends **marker** messages on all outgoing channels
2. **On receiving first marker**, a process:
   - Records its local state
   - Starts recording incoming messages on that channel
   - Sends markers on all outgoing channels
3. **On receiving subsequent markers**, a process:
   - Stops recording on that channel
   - The recorded messages form the channel state

### Key Requirements

- **FIFO channels**: Messages arrive in send order
- **Reliable delivery**: No message loss
- **Finite delay**: Messages eventually arrive

### Applicability to DOs

| Requirement | DO Environment | Adaptation Needed |
|-------------|----------------|-------------------|
| FIFO channels | Not guaranteed | Sequence numbers + reordering buffer |
| Reliable delivery | DO storage durable | RPC retries with idempotency |
| Process state | DO SQLite storage | Atomic snapshot via transaction |

## Flink's Barrier-Based Checkpointing

Apache Flink adapted Chandy-Lamport with [checkpoint barriers](https://flink.apache.org/2020/10/15/from-aligned-to-unaligned-checkpoints-part-1-checkpoints-alignment-and-backpressure/) that flow through the dataflow graph.

### How Barriers Work

1. **Coordinator** injects barriers at sources
2. Barriers flow with data, never overtaking records
3. Barriers separate "pre-checkpoint" from "post-checkpoint" epochs
4. When operator receives barriers from **all inputs**, it snapshots state

### Aligned vs Unaligned Checkpoints

| Mode | Mechanism | Pros | Cons |
|------|-----------|------|------|
| **Aligned** | Block channels until all barriers arrive | Simple, small snapshots | Latency under backpressure |
| **Unaligned** | Capture in-flight data as part of state | Fast under backpressure | Larger snapshots, complex recovery |

**Recommendation**: Start with aligned checkpoints. Add unaligned mode as optimization for backpressure scenarios.

## Existing Codebase Analysis

### Current Checkpoint Infrastructure

The codebase has foundational checkpoint primitives in `db/primitives/stateful-operator/`:

```typescript
// CheckpointBarrier - flows through dataflow
interface CheckpointBarrier {
  checkpointId: bigint
  timestamp: number
  options: CheckpointOptions  // mode: 'aligned' | 'unaligned'
}

// BarrierAligner - handles multi-input alignment
class BarrierAligner {
  processBarrier(channel: string, barrier: CheckpointBarrier): Promise<void>
  isBlocked(channel: string): boolean
}

// CheckpointCoordinator - orchestrates checkpoint lifecycle
class CheckpointCoordinator {
  triggerCheckpoint(options?: CheckpointOptions): Promise<CheckpointResult>
  acknowledgeSink(checkpointId: bigint, sinkIndex: number): void
}
```

**Location**: `/Users/nathanclevenger/projects/dotdo/db/primitives/stateful-operator/index.ts`

### DO State Backend

The `DOStateBackend` in `backends/do-backend.ts` provides:

- Namespaced key storage with TTL
- Atomic snapshot via DO transactions
- Checksum validation for integrity
- Batch operations for efficiency

### Cross-DO Transaction Primitives

The `CrossDOTransaction.ts` provides building blocks:

- **CrossDOSaga**: Compensating transactions with rollback
- **TwoPhaseCommit**: Atomic multi-DO operations
- **IdempotencyKeyManager**: Duplicate execution prevention

**Location**: `/Users/nathanclevenger/projects/dotdo/objects/CrossDOTransaction.ts`

### Single-DO Checkpoint Manager

`CheckpointManager` in `objects/persistence/checkpoint-manager.ts` handles:

- Periodic WAL-based checkpoints
- R2 snapshot storage with compression
- Checksum verification
- Schema-aware restoration

**Gap**: No coordination protocol for **multi-DO** checkpoints.

## Proposed Design: DO-Based Checkpoint Coordination

### Architecture Overview

```
                    +---------------------------+
                    | CheckpointCoordinatorDO   |
                    | - Trigger checkpoints     |
                    | - Track acknowledgements  |
                    | - Handle timeouts         |
                    +------------+--------------+
                                 |
            +--------------------+--------------------+
            |                    |                    |
    +-------v-------+    +-------v-------+    +-------v-------+
    | SourceDO      |    | OperatorDO    |    | SinkDO        |
    | - Inject      |    | - Align       |    | - Acknowledge |
    |   barriers    |    |   barriers    |    |   completion  |
    | - Persist     |    | - Snapshot    |    | - Snapshot    |
    |   offsets     |    |   state       |    |   state       |
    +---------------+    +---------------+    +---------------+
```

### Protocol Messages

```typescript
// Barrier injection from coordinator
interface CheckpointBarrierMessage {
  type: 'checkpoint_barrier'
  checkpointId: string
  epoch: bigint
  timestamp: number
  mode: 'aligned' | 'unaligned'
  timeout: number
  coordinatorId: string  // For acknowledgement routing
}

// Acknowledgement from operator to coordinator
interface CheckpointAckMessage {
  type: 'checkpoint_ack'
  checkpointId: string
  operatorId: string
  snapshotId: string
  success: boolean
  error?: string
  duration: number
  stateSize: number
}

// Abort message on timeout or failure
interface CheckpointAbortMessage {
  type: 'checkpoint_abort'
  checkpointId: string
  reason: string
  failedOperator?: string
}
```

### Coordination Protocol

#### Phase 1: Barrier Injection

```typescript
class CheckpointCoordinatorDO {
  async triggerCheckpoint(options: CheckpointOptions): Promise<CheckpointResult> {
    const checkpointId = this.generateCheckpointId()
    const epoch = this.nextEpoch++

    // Record pending checkpoint
    this.pendingCheckpoints.set(checkpointId, {
      epoch,
      startTime: Date.now(),
      acknowledgedOperators: new Set(),
      status: 'in_progress',
    })

    // Inject barriers at all sources in parallel
    const barrier: CheckpointBarrierMessage = {
      type: 'checkpoint_barrier',
      checkpointId,
      epoch,
      timestamp: Date.now(),
      mode: options.mode ?? 'aligned',
      timeout: options.timeout ?? 60000,
      coordinatorId: this.id,
    }

    await Promise.all(
      this.sources.map(source =>
        this.injectBarrier(source, barrier)
      )
    )

    // Wait for all acknowledgements
    return this.waitForCompletion(checkpointId, options.timeout)
  }
}
```

#### Phase 2: Barrier Propagation

```typescript
class StatefulOperatorDO {
  private barrierAligner: BarrierAligner
  private inputChannels: string[]

  async onBarrier(channel: string, barrier: CheckpointBarrierMessage) {
    // For aligned mode: track barriers from all inputs
    this.barrierAligner.processBarrier(channel, barrier)

    // When aligned (all barriers received)
    if (this.barrierAligner.allBarriersReceived(barrier.checkpointId)) {
      await this.performCheckpoint(barrier)

      // Forward barrier to downstream operators
      await this.forwardBarrier(barrier)
    }
  }

  private async performCheckpoint(barrier: CheckpointBarrierMessage) {
    const startTime = Date.now()

    // Snapshot state atomically
    const snapshot = await this.ctx.storage.transaction(async () => {
      return this.stateBackend.snapshot()
    })

    // Store snapshot in R2
    const snapshotId = await this.storeSnapshot(snapshot)

    // Send acknowledgement to coordinator
    await this.acknowledgeCheckpoint({
      checkpointId: barrier.checkpointId,
      operatorId: this.id,
      snapshotId,
      success: true,
      duration: Date.now() - startTime,
      stateSize: snapshot.metadata.totalBytes,
    })
  }
}
```

#### Phase 3: Completion & Commit

```typescript
class CheckpointCoordinatorDO {
  async onAcknowledgement(ack: CheckpointAckMessage) {
    const pending = this.pendingCheckpoints.get(ack.checkpointId)
    if (!pending) return // Stale ack

    if (!ack.success) {
      // Operator failed - abort checkpoint
      await this.abortCheckpoint(ack.checkpointId, ack.error)
      return
    }

    pending.acknowledgedOperators.add(ack.operatorId)
    pending.snapshots.set(ack.operatorId, ack.snapshotId)

    // Check if all operators acknowledged
    if (pending.acknowledgedOperators.size === this.allOperators.size) {
      await this.commitCheckpoint(ack.checkpointId, pending)
    }
  }

  private async commitCheckpoint(checkpointId: string, pending: PendingCheckpoint) {
    // Persist checkpoint metadata
    const metadata: CheckpointMetadata = {
      checkpointId,
      epoch: pending.epoch,
      timestamp: Date.now(),
      operatorSnapshots: Object.fromEntries(pending.snapshots),
      status: 'completed',
    }

    await this.ctx.storage.put(`checkpoint:${checkpointId}`, metadata)

    // Update latest checkpoint pointer
    await this.ctx.storage.put('checkpoint:latest', checkpointId)

    this.pendingCheckpoints.delete(checkpointId)
  }
}
```

### FIFO Channel Simulation

DOs don't guarantee message ordering. Implement logical FIFO channels:

```typescript
interface ChannelMessage<T> {
  sequenceNumber: bigint
  payload: T
  senderId: string
  timestamp: number
}

class FIFOChannel<T> {
  private nextExpectedSeq: bigint = 0n
  private reorderBuffer: Map<bigint, ChannelMessage<T>> = new Map()

  async receive(msg: ChannelMessage<T>): Promise<T[]> {
    // Buffer out-of-order messages
    this.reorderBuffer.set(msg.sequenceNumber, msg)

    // Deliver in-order messages
    const delivered: T[] = []
    while (this.reorderBuffer.has(this.nextExpectedSeq)) {
      const orderedMsg = this.reorderBuffer.get(this.nextExpectedSeq)!
      this.reorderBuffer.delete(this.nextExpectedSeq)
      delivered.push(orderedMsg.payload)
      this.nextExpectedSeq++
    }

    return delivered
  }
}
```

### In-Flight Message Handling

For aligned checkpoints, capture channel state:

```typescript
class ChannelStateCapture {
  private recordedMessages: Map<string, unknown[]> = new Map()
  private recording: Set<string> = new Set()

  startRecording(channel: string) {
    this.recording.add(channel)
    this.recordedMessages.set(channel, [])
  }

  stopRecording(channel: string): unknown[] {
    this.recording.delete(channel)
    const messages = this.recordedMessages.get(channel) ?? []
    this.recordedMessages.delete(channel)
    return messages
  }

  recordMessage(channel: string, message: unknown) {
    if (this.recording.has(channel)) {
      this.recordedMessages.get(channel)!.push(message)
    }
  }

  getChannelState(): Map<string, unknown[]> {
    return new Map(this.recordedMessages)
  }
}
```

## Failure Scenarios & Recovery

### Scenario 1: Operator DO Restarts During Checkpoint

**Problem**: DO crashes after receiving barrier but before acknowledging.

**Solution**:
- Coordinator tracks timeout per operator
- On timeout, retry barrier injection
- Operator uses idempotency key to prevent duplicate snapshots

```typescript
class CheckpointCoordinatorDO {
  private async handleOperatorTimeout(checkpointId: string, operatorId: string) {
    // Retry barrier injection with same checkpoint ID
    const barrier = this.pendingCheckpoints.get(checkpointId)!.barrier

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.injectBarrier(operatorId, barrier)
        return // Success
      } catch (error) {
        await sleep(1000 * Math.pow(2, attempt)) // Exponential backoff
      }
    }

    // All retries failed - abort checkpoint
    await this.abortCheckpoint(checkpointId, `Operator ${operatorId} unreachable`)
  }
}
```

### Scenario 2: Coordinator DO Restarts

**Problem**: Coordinator crashes during checkpoint coordination.

**Solution**:
- Persist pending checkpoint state to DO storage
- On restart, resume or abort pending checkpoints
- Operators timeout and discard stale barriers

```typescript
class CheckpointCoordinatorDO {
  async onStart() {
    // Load pending checkpoints from storage
    const pending = await this.ctx.storage.list({ prefix: 'pending:' })

    for (const [key, checkpoint] of pending) {
      const age = Date.now() - checkpoint.startTime

      if (age > checkpoint.timeout) {
        // Expired - clean up
        await this.ctx.storage.delete(key)
      } else {
        // Resume coordination
        this.pendingCheckpoints.set(checkpoint.checkpointId, checkpoint)
        await this.resumeCheckpoint(checkpoint)
      }
    }
  }
}
```

### Scenario 3: Network Partition During Checkpoint

**Problem**: Some operators unreachable, checkpoint cannot complete.

**Solution**:
- Global timeout triggers abort
- Operators independently timeout and discard barriers
- Next checkpoint starts fresh

```typescript
// Operator-side timeout
class StatefulOperatorDO {
  private barrierTimeout: number = 60000

  async onBarrier(channel: string, barrier: CheckpointBarrierMessage) {
    // Set timeout for this checkpoint
    const timeoutHandle = setTimeout(() => {
      this.discardStaleBarrier(barrier.checkpointId)
    }, this.barrierTimeout)

    this.barrierTimeouts.set(barrier.checkpointId, timeoutHandle)

    // Process barrier...
  }

  private discardStaleBarrier(checkpointId: string) {
    this.barrierAligner.clearBarriers(checkpointId)
    this.barrierTimeouts.delete(checkpointId)
    // Resume processing blocked channels
    this.barrierAligner.releaseAllBlocked()
  }
}
```

### Scenario 4: Partial Checkpoint Completion

**Problem**: Some operators acknowledged, others failed, then coordinator crashes.

**Solution**:
- Checkpoints are only valid when ALL operators acknowledge
- On recovery, incomplete checkpoints are discarded
- Snapshots from incomplete checkpoints are garbage collected

```typescript
class CheckpointCoordinatorDO {
  async cleanupIncompleteCheckpoints() {
    const checkpoints = await this.ctx.storage.list({ prefix: 'checkpoint:' })

    for (const [key, metadata] of checkpoints) {
      if (metadata.status !== 'completed') {
        // Delete incomplete checkpoint metadata
        await this.ctx.storage.delete(key)

        // Request snapshot cleanup from operators
        for (const [opId, snapshotId] of Object.entries(metadata.operatorSnapshots ?? {})) {
          await this.requestSnapshotCleanup(opId, snapshotId)
        }
      }
    }
  }
}
```

## Recovery Protocol

### Full Recovery from Checkpoint

```typescript
class DataflowRecoveryManager {
  async recoverFromLatestCheckpoint() {
    // 1. Get latest completed checkpoint from coordinator
    const checkpoint = await this.coordinator.getLatestCheckpoint()
    if (!checkpoint) {
      throw new Error('No checkpoint available for recovery')
    }

    // 2. Stop all operators
    await Promise.all(
      this.operators.map(op => op.pause())
    )

    // 3. Restore each operator's state in parallel
    await Promise.all(
      this.operators.map(async (op) => {
        const snapshotId = checkpoint.operatorSnapshots[op.id]
        await op.restoreFromSnapshot(snapshotId)
      })
    )

    // 4. Reset source offsets to checkpoint positions
    await Promise.all(
      this.sources.map(async (source) => {
        const offset = checkpoint.sourceOffsets[source.id]
        await source.seekToOffset(offset)
      })
    )

    // 5. Resume processing
    await Promise.all(
      this.operators.map(op => op.resume())
    )
  }
}
```

### Exactly-Once via Epoch-Based Deduplication

```typescript
class ExactlyOnceOperator {
  private currentEpoch: bigint = 0n
  private processedInEpoch: Set<string> = new Set()

  async processRecord(record: Record, epoch: bigint) {
    // Reject records from old epochs (already processed)
    if (epoch < this.currentEpoch) {
      return // Skip - already processed in previous epoch
    }

    // Track processed record IDs within epoch
    const recordId = this.getRecordId(record)
    if (this.processedInEpoch.has(recordId)) {
      return // Skip - duplicate within epoch
    }

    // Process the record
    await this.process(record)
    this.processedInEpoch.add(recordId)
  }

  async onCheckpointComplete(epoch: bigint) {
    // Advance epoch, clear dedup set
    this.currentEpoch = epoch + 1n
    this.processedInEpoch.clear()
  }
}
```

## Performance Considerations

### Latency Analysis

Based on cross-DO latency data from `docs/spikes/cross-do-join-latency.md`:

| Operation | Same-Colo p50 | Cross-Colo p50 |
|-----------|---------------|----------------|
| Barrier injection (1 DO) | ~3ms | ~80ms |
| Barrier injection (10 DOs parallel) | ~8ms | ~150ms |
| State snapshot (10K keys) | ~20ms | ~20ms |
| R2 snapshot upload | ~50ms | ~100ms |
| Coordinator ack processing | ~2ms | ~2ms |

**Total checkpoint time (10 DOs, same-colo)**: ~80-100ms

### Optimization Strategies

1. **Parallel barrier injection**: Inject to all sources simultaneously
2. **Async snapshots**: Snapshot state asynchronously after barrier forwarding
3. **Incremental snapshots**: Only snapshot changed state (delta checkpoints)
4. **Snapshot compression**: gzip compression reduces R2 transfer time

### Backpressure Handling

For aligned checkpoints under backpressure:

```typescript
class BackpressureAwareBarrierAligner {
  private blockedChannels = new Set<string>()
  private maxBlockedTime = 30000 // 30s max blocking

  async processBarrier(channel: string, barrier: CheckpointBarrier) {
    const blockStart = Date.now()
    this.blockedChannels.add(channel)

    // Check for timeout periodically
    const checkInterval = setInterval(() => {
      if (Date.now() - blockStart > this.maxBlockedTime) {
        // Switch to unaligned mode
        this.switchToUnalignedMode(barrier)
        clearInterval(checkInterval)
      }
    }, 1000)

    // Wait for alignment or mode switch
    await this.waitForAlignment(barrier.checkpointId)
    clearInterval(checkInterval)
  }

  private switchToUnalignedMode(barrier: CheckpointBarrier) {
    // Capture in-flight data from blocked channels
    const inFlightData = this.captureInFlightData()

    // Snapshot immediately with in-flight data
    this.performUnalignedCheckpoint(barrier, inFlightData)
  }
}
```

## Implementation Roadmap

### Phase 1: Core Coordination (P0)

- [ ] Create `CheckpointCoordinatorDO` class
- [ ] Implement barrier injection protocol
- [ ] Add barrier alignment logic to operators
- [ ] Implement acknowledgement handling
- [ ] Add timeout and abort handling

### Phase 2: Recovery (P0)

- [ ] Implement checkpoint metadata storage
- [ ] Add snapshot storage to R2
- [ ] Implement recovery protocol
- [ ] Add epoch-based deduplication

### Phase 3: Optimizations (P1)

- [ ] Add async snapshot support
- [ ] Implement incremental/delta checkpoints
- [ ] Add unaligned checkpoint mode
- [ ] Implement backpressure detection

### Phase 4: Observability (P2)

- [ ] Add checkpoint metrics (duration, size, success rate)
- [ ] Implement checkpoint history API
- [ ] Add recovery time metrics
- [ ] Create checkpoint monitoring dashboard

## Open Questions

1. **Checkpoint storage location**: R2 per-tenant bucket vs shared bucket with prefixes?
2. **Checkpoint retention**: How long to keep old checkpoints? Policy per dataflow?
3. **Cross-region recovery**: How to handle recovery when coordinator colo changes?
4. **Savepoints**: Should we support manual savepoints distinct from automatic checkpoints?
5. **Schema evolution**: How to handle schema changes between checkpoint and recovery?

## References

### Research Papers
- [Chandy-Lamport Algorithm](https://lamport.azurewebsites.net/pubs/chandy.pdf) - Original 1985 paper
- [Lightweight Asynchronous Snapshots for Distributed Dataflows](https://arxiv.org/abs/1506.08603) - Flink's approach

### Flink Documentation
- [Checkpointing](https://nightlies.apache.org/flink/flink-docs-master/docs/dev/datastream/fault-tolerance/checkpointing/)
- [Stateful Stream Processing](https://nightlies.apache.org/flink/flink-docs-master/docs/concepts/stateful-stream-processing/)
- [From Aligned to Unaligned Checkpoints](https://flink.apache.org/2020/10/15/from-aligned-to-unaligned-checkpoints-part-1-checkpoints-alignment-and-backpressure/)
- [Checkpointing under Backpressure](https://nightlies.apache.org/flink/flink-docs-master/docs/ops/state/checkpointing_under_backpressure/)

### Codebase References
- `db/primitives/stateful-operator/index.ts` - Existing checkpoint primitives
- `db/primitives/stateful-operator/backends/do-backend.ts` - DO state backend
- `objects/CrossDOTransaction.ts` - Cross-DO transaction patterns
- `objects/persistence/checkpoint-manager.ts` - Single-DO checkpoint manager
- `db/primitives/exactly-once-context.ts` - Exactly-once processing context

---

## See Also

### Related Spikes

- [Cross-DO Join Latency](./cross-do-join-latency.md) - Latency analysis used for checkpoint timing budgets
- [Checkpoint Size Limits](./checkpoint-size-limits.md) - Storage limits affecting checkpoint design
- [Exactly-Once Hibernation](./exactly-once-hibernation.md) - Epoch-based deduplication patterns
- [Broadcast Join Strategy](./broadcast-join-strategy.md) - Parallel fan-out patterns applicable to barrier injection

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - Module boundaries for checkpoint coordination

### Spikes Index

- [All Spikes](./README.md) - Complete index of research spikes
