[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowCore

# Class: WorkflowCore

Defined in: [workflows/core/workflow-core.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L103)

WorkflowCore composes unified primitives into a workflow execution foundation.

## Constructors

### Constructor

> **new WorkflowCore**(`options`): `WorkflowCore`

Defined in: [workflows/core/workflow-core.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L119)

#### Parameters

##### options

[`WorkflowCoreOptions`](../interfaces/WorkflowCoreOptions.md)

#### Returns

`WorkflowCore`

## Methods

### applyPatch()

> **applyPatch**(`patchId`): `boolean`

Defined in: [workflows/core/workflow-core.ts:239](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L239)

Apply a version patch.
Returns true if patch was newly applied, false if already applied.

#### Parameters

##### patchId

`string`

#### Returns

`boolean`

***

### checkpoint()

> **checkpoint**(): `Promise`\<[`CheckpointState`](../interfaces/CheckpointState.md)\>

Defined in: [workflows/core/workflow-core.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L359)

Create a checkpoint of current workflow state.

#### Returns

`Promise`\<[`CheckpointState`](../interfaces/CheckpointState.md)\>

***

### createTimer()

> **createTimer**(`duration`): [`TimerHandle`](../interfaces/TimerHandle.md)

Defined in: [workflows/core/workflow-core.ts:287](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L287)

Create a timer that fires after the specified duration.

#### Parameters

##### duration

`string` | `number` | `DurationObject`

#### Returns

[`TimerHandle`](../interfaces/TimerHandle.md)

***

### dispose()

> **dispose**(): `void`

Defined in: [workflows/core/workflow-core.ts:442](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L442)

Dispose of all resources.

#### Returns

`void`

***

### executeStep()

> **executeStep**\<`T`\>(`stepId`, `fn`): `Promise`\<`T`\>

Defined in: [workflows/core/workflow-core.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L157)

Execute a step exactly once, returning cached result on replay.

#### Type Parameters

##### T

`T`

#### Parameters

##### stepId

`string`

##### fn

() => `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

***

### getHistory()

> **getHistory**(): `Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

Defined in: [workflows/core/workflow-core.ts:184](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L184)

Get all workflow history events.

#### Returns

`Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

***

### getHistoryAsOf()

> **getHistoryAsOf**(`timestamp`): `Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

Defined in: [workflows/core/workflow-core.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L191)

Get history as of a specific timestamp (time-travel query).

#### Parameters

##### timestamp

`number`

#### Returns

`Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

***

### getHistoryLength()

> **getHistoryLength**(): `Promise`\<`number`\>

Defined in: [workflows/core/workflow-core.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L198)

Get current history length.

#### Returns

`Promise`\<`number`\>

***

### getVersion()

> **getVersion**(): `number`

Defined in: [workflows/core/workflow-core.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L276)

Get current workflow version.

#### Returns

`number`

***

### isPatchApplied()

> **isPatchApplied**(`patchId`): `boolean`

Defined in: [workflows/core/workflow-core.ts:269](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L269)

Check if a patch has been applied.

#### Parameters

##### patchId

`string`

#### Returns

`boolean`

***

### isStepCompleted()

> **isStepCompleted**(`stepId`): `Promise`\<`boolean`\>

Defined in: [workflows/core/workflow-core.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L165)

Check if a step has been completed.

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### pruneHistory()

> **pruneHistory**(`policy?`): `Promise`\<\{ `versionsRemoved`: `number`; \}\>

Defined in: [workflows/core/workflow-core.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L227)

Prune old history events based on retention policy.
Useful for Continue-As-New to prevent unbounded history growth.

#### Parameters

##### policy?

[`RetentionPolicy`](../interfaces/RetentionPolicy.md)

Retention policy to apply

#### Returns

`Promise`\<\{ `versionsRemoved`: `number`; \}\>

***

### recordEvent()

> **recordEvent**(`event`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core.ts:177](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L177)

Record a workflow event to history.

#### Parameters

##### event

[`WorkflowEvent`](../interfaces/WorkflowEvent.md)

#### Returns

`Promise`\<`void`\>

***

### restore()

> **restore**(`state`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core.ts:387](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L387)

Restore workflow state from a checkpoint.

#### Parameters

##### state

[`CheckpointState`](../interfaces/CheckpointState.md)

#### Returns

`Promise`\<`void`\>

***

### restoreHistorySnapshot()

> **restoreHistorySnapshot**(`snapshotId`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L217)

Restore workflow history to a previous snapshot.

#### Parameters

##### snapshotId

`string`

Snapshot to restore

#### Returns

`Promise`\<`void`\>

***

### sleep()

> **sleep**(`duration`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core.ts:333](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L333)

Sleep for the specified duration.

#### Parameters

##### duration

`string` | `number` | `DurationObject`

#### Returns

`Promise`\<`void`\>

***

### snapshotHistory()

> **snapshotHistory**(): `Promise`\<`string`\>

Defined in: [workflows/core/workflow-core.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L208)

Create a snapshot of the current workflow history.
Useful for Continue-As-New and checkpointing.

#### Returns

`Promise`\<`string`\>

Unique snapshot identifier
