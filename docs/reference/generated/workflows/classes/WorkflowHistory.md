[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowHistory

# Class: WorkflowHistory

Defined in: [workflows/core/workflow-history.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L124)

WorkflowHistory provides time-travel enabled workflow history tracking.

Backed by TemporalStore for efficient:
- Event recording with timestamps
- Time-travel queries (getAsOf)
- Snapshots for checkpointing
- Retention policies for memory management

## Example

```typescript
const history = createWorkflowHistory({ workflowId: 'order-123' })

// Record events
await history.recordEvent({
  type: 'STEP_COMPLETED',
  timestamp: Date.now(),
  stepId: 'fetch-data',
  result: { data: 'fetched' }
})

// Time-travel query
const pastEvents = await history.getEventsAsOf(pastTimestamp)

// Create snapshot
const snapshotId = await history.snapshot()

// Restore snapshot
await history.restoreSnapshot(snapshotId)

// Apply retention
await history.prune({ maxVersions: 100, maxAge: '7d' })
```

## Constructors

### Constructor

> **new WorkflowHistory**(`options`): `WorkflowHistory`

Defined in: [workflows/core/workflow-history.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L141)

#### Parameters

##### options

[`WorkflowHistoryOptions`](../interfaces/WorkflowHistoryOptions.md)

#### Returns

`WorkflowHistory`

## Methods

### compact()

> **compact**(`policy?`): `Promise`\<[`PruneStats`](../interfaces/PruneStats.md)\>

Defined in: [workflows/core/workflow-history.ts:352](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L352)

Alias for prune - compact old history.

#### Parameters

##### policy?

[`RetentionPolicy`](../interfaces/RetentionPolicy.md)

Optional policy override

#### Returns

`Promise`\<[`PruneStats`](../interfaces/PruneStats.md)\>

Statistics about what was compacted

***

### dispose()

> **dispose**(): `void`

Defined in: [workflows/core/workflow-history.ts:417](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L417)

Dispose of all resources.

#### Returns

`void`

***

### exportCheckpoint()

> **exportCheckpoint**(): `Promise`\<[`HistoryCheckpoint`](../interfaces/HistoryCheckpoint.md)\>

Defined in: [workflows/core/workflow-history.ts:384](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L384)

Export checkpoint state for WorkflowCore compatibility.

#### Returns

`Promise`\<[`HistoryCheckpoint`](../interfaces/HistoryCheckpoint.md)\>

Checkpoint state that can be restored later

***

### getEvents()

> **getEvents**(): `Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md)[]\>

Defined in: [workflows/core/workflow-history.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L192)

Get all recorded events.

#### Returns

`Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md)[]\>

Array of all history events in order

***

### getEventsAsOf()

> **getEventsAsOf**(`timestamp`): `Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md)[]\>

Defined in: [workflows/core/workflow-history.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L218)

Get all events as of a specific timestamp.
Time-travel query that returns events up to and including the timestamp.

Uses TemporalStore's getAsOf for efficient O(log n) queries on recent data.

#### Parameters

##### timestamp

`number`

Point in time to query

#### Returns

`Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md)[]\>

Events up to that timestamp

***

### getLength()

> **getLength**(): `Promise`\<`number`\>

Defined in: [workflows/core/workflow-history.ts:201](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L201)

Get the number of recorded events.

#### Returns

`Promise`\<`number`\>

History length

***

### getRetentionPolicy()

> **getRetentionPolicy**(): [`RetentionPolicy`](../interfaces/RetentionPolicy.md) \| `undefined`

Defined in: [workflows/core/workflow-history.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L361)

Get the current retention policy.

#### Returns

[`RetentionPolicy`](../interfaces/RetentionPolicy.md) \| `undefined`

Current policy or undefined

***

### getStateAsOf()

> **getStateAsOf**(`key`, `timestamp`): `Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md) \| `null`\>

Defined in: [workflows/core/workflow-history.ts:231](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L231)

Get a specific keyed state as of a timestamp.
Useful for querying workflow state at a point in time.

#### Parameters

##### key

`string`

State key to query

##### timestamp

`number`

Point in time

#### Returns

`Promise`\<[`HistoryEvent`](../interfaces/HistoryEvent.md) \| `null`\>

State value at that time or null

***

### importCheckpoint()

> **importCheckpoint**(`checkpoint`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-history.ts:400](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L400)

Import checkpoint state from WorkflowCore.

#### Parameters

##### checkpoint

[`HistoryCheckpoint`](../interfaces/HistoryCheckpoint.md)

Checkpoint state to import

#### Returns

`Promise`\<`void`\>

***

### listSnapshots()

> **listSnapshots**(): `Promise`\<[`HistorySnapshot`](../interfaces/HistorySnapshot.md)[]\>

Defined in: [workflows/core/workflow-history.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L291)

List all available snapshots with metadata.

#### Returns

`Promise`\<[`HistorySnapshot`](../interfaces/HistorySnapshot.md)[]\>

Array of snapshot information

***

### prune()

> **prune**(`policy?`): `Promise`\<[`PruneStats`](../interfaces/PruneStats.md)\>

Defined in: [workflows/core/workflow-history.ts:309](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L309)

Prune old events based on retention policy.

#### Parameters

##### policy?

[`RetentionPolicy`](../interfaces/RetentionPolicy.md)

Optional policy override (uses default if not provided)

#### Returns

`Promise`\<[`PruneStats`](../interfaces/PruneStats.md)\>

Statistics about what was pruned

***

### recordEvent()

> **recordEvent**(`event`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-history.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L169)

Record a workflow event with timestamp.

#### Parameters

##### event

[`HistoryEvent`](../interfaces/HistoryEvent.md)

Event to record (must have type and timestamp)

#### Returns

`Promise`\<`void`\>

#### Throws

Error if event is missing type or timestamp

***

### recordState()

> **recordState**(`key`, `event`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-history.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L243)

Record a keyed state with timestamp.
Useful for tracking named state values with time-travel capability.

#### Parameters

##### key

`string`

State key

##### event

[`HistoryEvent`](../interfaces/HistoryEvent.md)

State event to record

#### Returns

`Promise`\<`void`\>

***

### restoreSnapshot()

> **restoreSnapshot**(`id`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-history.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L272)

Restore the history to a previous snapshot state.

#### Parameters

##### id

`string`

Snapshot ID to restore

#### Returns

`Promise`\<`void`\>

#### Throws

Error if snapshot not found

***

### setRetentionPolicy()

> **setRetentionPolicy**(`policy`): `void`

Defined in: [workflows/core/workflow-history.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L370)

Set the default retention policy.

#### Parameters

##### policy

New policy or undefined to disable

[`RetentionPolicy`](../interfaces/RetentionPolicy.md) | `undefined`

#### Returns

`void`

***

### snapshot()

> **snapshot**(): `Promise`\<`string`\>

Defined in: [workflows/core/workflow-history.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L259)

Create a point-in-time snapshot of the history.

#### Returns

`Promise`\<`string`\>

Unique snapshot identifier
