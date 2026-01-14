# Spike: Snapshot + CDC Cutover Consistency

**Issue:** dotdo-ewnln
**Risk:** How to achieve consistent point-in-time cutover from snapshot to CDC stream?
**Date:** 2026-01-13

## Overview

This spike documents the patterns and implementation strategies for achieving zero data loss during the transition from initial snapshot capture to live CDC streaming. The challenge is ensuring exactly-once delivery semantics across the cutover boundary.

## Problem Statement

When initializing a CDC pipeline, we must:
1. Capture the initial state of all existing data (snapshot)
2. Switch to streaming live changes (CDC)
3. Ensure no gaps (data loss) or duplicates during transition

The complexity arises because changes continue to occur during the snapshot process:
- An INSERT during snapshot may or may not be captured in the snapshot
- An UPDATE to a snapshotted record may arrive before we finish
- A DELETE could remove a record we already snapshotted

## Snapshot Completion Detection

### Pattern 1: WAL Position Bookmarking (Implemented)

Capture the WAL position **before** starting the snapshot:

```typescript
// From snapshot-manager.ts
export interface SnapshotState {
  walPositionAtStart: string | null;  // LSN/GTID captured before snapshot
  // ...
}
```

**How it works:**
1. Capture current WAL position (LSN for Postgres, GTID for MySQL)
2. Start snapshot scan
3. When snapshot completes, we know all changes with LSN <= `walPositionAtStart` are in the snapshot
4. Stream changes starting from `walPositionAtStart + 1`

**Implementation in dotdo:**
- `SnapshotManager.initialWalPosition` - set before snapshot starts
- `SnapshotManager.getCutoverInfo()` - returns WAL position for CDC resumption

### Pattern 2: Chunk-Based Progress Tracking (Implemented)

For crash recovery and resumption:

```typescript
export interface SnapshotState {
  cursor: string | null;        // Primary key cursor position
  rowsProcessed: number;        // Progress tracking
  chunksCompleted: number;      // Checkpoint granularity
  processedRecordIds?: string[]; // For deduplication on resume
}
```

**Key files:**
- `/db/primitives/cdc/snapshot-manager.ts` - SnapshotManager class
- `/db/primitives/cdc/offset-tracker.ts` - OffsetTracker for position management

## CDC Start Position (LSN/GTID)

### PostgreSQL LSN Format

Log Sequence Number format: `segment/offset` (e.g., `0/16B3740`)

```typescript
// From offset-tracker.ts
function parseLSN(lsn: string): bigint {
  const [segment, offset] = lsn.split('/')
  const segmentNum = BigInt(parseInt(segment, 10))
  const offsetNum = BigInt(parseInt(offset, 16))
  return (segmentNum << 32n) | offsetNum
}
```

**Comparison:** LSNs are numerically comparable after parsing.

### MySQL GTID Format

Global Transaction ID format: `uuid:start-end` (e.g., `3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5`)

```typescript
// From offset-tracker.ts
function parseGTID(gtid: string): { uuid: string; range: [number, number] } {
  const match = gtid.match(/^([A-Fa-f0-9-]+):(\d+)-(\d+)$/)
  return {
    uuid: match[1],
    range: [parseInt(match[2], 10), parseInt(match[3], 10)],
  }
}
```

**Comparison:** Compare by transaction count within same server UUID.

### Position Resumption Strategy

```typescript
// After snapshot completes:
const cutover = snapshotManager.getCutoverInfo()
const cdcStartPosition = cutover.walPositionAtStart

// Start CDC from this position
await walReader.connect()
await walReader.seekTo(cdcStartPosition)
```

## Deduplication During Overlap

### The Overlap Problem

During snapshot, changes accumulate in the WAL. When we start CDC streaming from `walPositionAtStart`, we may receive changes for records that were:
1. **Already in snapshot** - these are duplicates
2. **Modified after being snapshotted** - these need to be applied
3. **Never in snapshot** (new records) - these need to be applied

### Deduplication Strategy (Implemented)

**Pattern: Record ID + LSN Comparison**

```typescript
// From snapshot-manager.ts
shouldFilterLiveEvent(recordId: string, lsn: string): boolean {
  // If record was in snapshot, filter events with LSN <= snapshot start
  if (this.snapshotRecordIds.has(recordId)) {
    if (this.state.walPositionAtStart && lsn <= this.state.walPositionAtStart) {
      return true  // Duplicate - already in snapshot
    }
    return true  // Let snapshot version take precedence
  }
  return false  // New record - process it
}
```

**Implementation in dotdo:**
- `SnapshotManager.trackRecordIds` option enables record tracking
- `SnapshotManager.getSnapshotRecordIds()` returns Set of snapshotted IDs
- `SnapshotManager.wasRecordSnapshotted(id)` checks if record was captured

### Idempotency Key Strategy

From `exactly-once-delivery.ts`:

```typescript
export class ExactlyOnceDelivery<T> {
  private deduplicationCache: Map<IdempotencyKey, number> = new Map()

  isDuplicate(idempotencyKey: IdempotencyKey): boolean {
    const processedAt = this.deduplicationCache.get(idempotencyKey)
    if (!processedAt) return false

    // Check deduplication window
    const elapsed = Date.now() - processedAt
    return elapsed < this.options.deduplicationWindowMs
  }
}
```

**Key insight:** Use composite idempotency keys: `{table}:{recordId}:{lsn}`

## Exactly-Once Guarantees

### Two-Phase Approach (Implemented)

From `exactly-once-delivery.ts`:

```
Event Source -> Deduplication -> Transaction Log -> Processing -> Offset Commit
                    |                                   |
                    v                                   v
             [Duplicate?]                        [Success?]
                    |                                   |
                 [Skip]                            [DLQ/Retry]
```

### Transaction Logging

```typescript
type LogEntryType = 'PREPARE' | 'COMMIT' | 'ROLLBACK' | 'CHECKPOINT' | 'OFFSET_COMMIT' | 'DLQ_ENTRY'

interface TransactionLogEntry {
  id: string
  type: LogEntryType
  transactionId: TransactionId
  idempotencyKey: IdempotencyKey
  offset?: Offset
  status: DeliveryStatus
}
```

### Two-Phase Commit for Distributed Scenarios

```typescript
// Prepare phase
const txId = await delivery.prepare({
  idempotencyKey: 'order-123-created',
  payload: orderData,
  participants: ['orders', 'payments', 'inventory'],
})

try {
  // Commit only after all participants ready
  await delivery.commit(txId)
} catch (error) {
  await delivery.rollback(txId)
}
```

## Cutover Algorithm

### Recommended Sequence

```
1. LOCK_WAL_POSITION
   - walPositionAtStart = getCurrentWALPosition()
   - startBufferingLiveChanges()

2. SNAPSHOT_PHASE
   - for each chunk:
       - scanChunk(cursor, chunkSize)
       - emitSyntheticInserts(records)
       - saveCheckpoint(state)
   - snapshotComplete = true

3. APPLY_BUFFERED_CHANGES
   - for each bufferedChange:
       - if shouldFilterLiveEvent(change):
           skip (already in snapshot)
       - else:
           apply(change)

4. SWITCH_TO_STREAMING
   - stopBuffering()
   - startStreaming(walPositionAtStart)
```

### Multi-Table Coordination

From `multi-table-coordinator.ts`:

```typescript
interface CoordinatedSnapshotState {
  phase: 'capturing_position' | 'snapshotting' | 'completed'
  walPositionAtStart: WALPosition | null
  tableStates: Map<string, SnapshotState>
  tableOrder: string[]  // Respect FK dependencies
}
```

**Key consideration:** Snapshot tables in dependency order (parents before children) to maintain referential integrity.

## Failure Modes and Recovery

### Crash During Snapshot

**Recovery pattern:**
1. Load `SnapshotState` from checkpoint
2. Resume from `cursor` position
3. Use `processedRecordIds` to avoid re-emitting duplicates

```typescript
const manager = createSnapshotManager({
  resumeFrom: savedState,
  trackRecordIds: true,
  // ...
})
```

### Crash During Cutover

**Recovery pattern:**
1. Check if snapshot completed (`phase === COMPLETED`)
2. Load `walPositionAtStart` from checkpoint
3. Start CDC from that position with deduplication enabled

### Crash During CDC

**Recovery pattern:**
1. Load last committed offset from `OffsetTracker`
2. Resume from committed position
3. Deduplication handles any reprocessed events

## Test Scenarios

### Required Tests (see `tests/cutover-consistency.test.ts`)

1. **Basic cutover** - snapshot completes, CDC starts, no duplicates
2. **Concurrent INSERT during snapshot** - new record handled correctly
3. **Concurrent UPDATE to snapshotted record** - latest version wins
4. **Concurrent DELETE of snapshotted record** - delete applied
5. **Crash during snapshot** - resume without data loss
6. **Crash during cutover** - recover to consistent state
7. **High concurrency** - many changes during snapshot
8. **Multi-table coordination** - FK relationships preserved

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| SnapshotManager | Complete | Chunk-based, resumable |
| OffsetTracker | Complete | LSN/GTID support |
| ExactlyOnceDelivery | Complete | 2PC, DLQ, deduplication |
| MultiTableCoordinator | Complete | FK ordering, coordinated snapshots |
| Cutover Tests | Partial | Basic tests exist, need edge cases |

## Recommendations

1. **Always capture WAL position before snapshot** - critical for consistency
2. **Track record IDs during snapshot** - enables precise deduplication
3. **Use idempotency keys** - prevents duplicates during overlap
4. **Implement checkpoint after each chunk** - enables crash recovery
5. **Test concurrent DML scenarios** - validates cutover logic
6. **Monitor lag during cutover** - alerts if buffer grows too large

## References

- [Debezium Snapshots Documentation](https://debezium.io/documentation/reference/stable/connectors/postgresql.html#postgresql-snapshots)
- [Kafka Connect Exactly-Once Semantics](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- PostgreSQL Logical Replication: `pg_current_wal_lsn()`
- MySQL Binary Log: `SHOW MASTER STATUS`

## Key Files

- `/db/primitives/cdc/snapshot-manager.ts` - SnapshotManager implementation
- `/db/primitives/cdc/offset-tracker.ts` - Position tracking with LSN/GTID
- `/db/primitives/cdc/exactly-once-delivery.ts` - Exactly-once guarantees
- `/db/primitives/cdc/multi-table-coordinator.ts` - Coordinated snapshots
- `/db/primitives/cdc/wal-reader.ts` - WAL/binlog abstraction
