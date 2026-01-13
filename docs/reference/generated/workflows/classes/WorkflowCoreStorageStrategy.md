[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowCoreStorageStrategy

# Class: WorkflowCoreStorageStrategy

Defined in: [workflows/core/workflow-core-storage.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L139)

WorkflowCoreStorageStrategy implements the storage strategy interface
using WorkflowCore as the underlying primitive composition.

This enables all workflow compat layers to share the same:
- Exactly-once step execution semantics
- Time-travel enabled history
- Timer management with WindowManager
- Workflow versioning with SchemaEvolution

## Example

```typescript
const strategy = new WorkflowCoreStorageStrategy({
  workflowId: 'order-processing-123',
  enableHistory: true
})

// Execute steps with exactly-once semantics
const result = await strategy.executeStep('fetch-order', async () => {
  return await fetchOrder(orderId)
})

// Sleep with timer management
await strategy.sleep('wait-for-payment', 5000, '5s')

// Create checkpoint for durability
const checkpoint = await strategy.checkpoint()
```

## Implements

- [`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md)

## Constructors

### Constructor

> **new WorkflowCoreStorageStrategy**(`options`): `WorkflowCoreStorageStrategy`

Defined in: [workflows/core/workflow-core-storage.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L147)

#### Parameters

##### options

[`WorkflowCoreStorageOptions`](../interfaces/WorkflowCoreStorageOptions.md)

#### Returns

`WorkflowCoreStorageStrategy`

## Methods

### applyPatch()

> **applyPatch**(`patchId`): `boolean`

Defined in: [workflows/core/workflow-core-storage.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L347)

Apply a version patch for workflow evolution.

#### Parameters

##### patchId

`string`

#### Returns

`boolean`

***

### checkpoint()

> **checkpoint**(): `Promise`\<[`CheckpointState`](../interfaces/CheckpointState.md)\>

Defined in: [workflows/core/workflow-core-storage.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L373)

Create a checkpoint of current workflow state.
Can be used for Continue-As-New or durability.

#### Returns

`Promise`\<[`CheckpointState`](../interfaces/CheckpointState.md)\>

***

### clear()

> **clear**(): `void`

Defined in: [workflows/core/workflow-core-storage.ts:411](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L411)

Clear local cache (for testing).

#### Returns

`void`

***

### createTimer()

> **createTimer**(`duration`): [`TimerHandle`](../interfaces/TimerHandle.md)

Defined in: [workflows/core/workflow-core-storage.ts:400](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L400)

Create a timer that fires after the specified duration.

#### Parameters

##### duration

`string` | `number`

#### Returns

[`TimerHandle`](../interfaces/TimerHandle.md)

***

### dispose()

> **dispose**(): `void`

Defined in: [workflows/core/workflow-core-storage.ts:418](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L418)

Dispose of all resources.

#### Returns

`void`

***

### executeStep()

> **executeStep**\<`T`\>(`name`, `fn`, `_options?`): `Promise`\<`T`\>

Defined in: [workflows/core/workflow-core-storage.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L173)

Execute a step with exactly-once semantics.
Uses WorkflowCore.executeStep which is backed by ExactlyOnceContext.

#### Type Parameters

##### T

`T`

#### Parameters

##### name

`string`

##### fn

() => `T` \| `Promise`\<`T`\>

##### \_options?

[`StepExecutionOptions`](../interfaces/StepExecutionOptions.md)

#### Returns

`Promise`\<`T`\>

#### Implementation of

[`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md).[`executeStep`](../interfaces/WorkflowStorageStrategy.md#executestep)

***

### getCore()

> **getCore**(): [`WorkflowCore`](WorkflowCore.md)

Defined in: [workflows/core/workflow-core-storage.ts:431](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L431)

Get the underlying WorkflowCore instance.
Useful for advanced operations like history snapshots.

#### Returns

[`WorkflowCore`](WorkflowCore.md)

***

### getHistory()

> **getHistory**(): `Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

Defined in: [workflows/core/workflow-core-storage.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L321)

Get all workflow history events.
Provides time-travel debugging capability.

#### Returns

`Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

***

### getHistoryAsOf()

> **getHistoryAsOf**(`timestamp`): `Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

Defined in: [workflows/core/workflow-core-storage.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L329)

Get history as of a specific timestamp.
Enables time-travel debugging.

#### Parameters

##### timestamp

`number`

#### Returns

`Promise`\<[`WorkflowEvent`](../interfaces/WorkflowEvent.md)[]\>

***

### getHistoryLength()

> **getHistoryLength**(): `Promise`\<`number`\>

Defined in: [workflows/core/workflow-core-storage.ts:336](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L336)

Get current history length.

#### Returns

`Promise`\<`number`\>

***

### getStepResult()

> **getStepResult**\<`T`\>(`name`): `Promise`\<`T` \| `undefined`\>

Defined in: [workflows/core/workflow-core-storage.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L291)

Get the cached result of a completed step.

#### Type Parameters

##### T

`T`

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`T` \| `undefined`\>

#### Implementation of

[`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md).[`getStepResult`](../interfaces/WorkflowStorageStrategy.md#getstepresult)

***

### getVersion()

> **getVersion**(): `number`

Defined in: [workflows/core/workflow-core-storage.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L361)

Get current workflow version.

#### Returns

`number`

***

### isPatchApplied()

> **isPatchApplied**(`patchId`): `boolean`

Defined in: [workflows/core/workflow-core-storage.ts:354](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L354)

Check if a patch has been applied.

#### Parameters

##### patchId

`string`

#### Returns

`boolean`

***

### isStepCompleted()

> **isStepCompleted**(`name`): `Promise`\<`boolean`\>

Defined in: [workflows/core/workflow-core-storage.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L278)

Check if a step has been completed.

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md).[`isStepCompleted`](../interfaces/WorkflowStorageStrategy.md#isstepcompleted)

***

### restore()

> **restore**(`state`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core-storage.ts:380](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L380)

Restore workflow state from a checkpoint.

#### Parameters

##### state

[`CheckpointState`](../interfaces/CheckpointState.md)

#### Returns

`Promise`\<`void`\>

***

### setStepResult()

> **setStepResult**(`name`, `result`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core-storage.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L305)

Store a step result (for replay or external persistence).

#### Parameters

##### name

`string`

##### result

`unknown`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md).[`setStepResult`](../interfaces/WorkflowStorageStrategy.md#setstepresult)

***

### sleep()

> **sleep**(`name`, `durationMs`, `durationStr`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core-storage.ts:232](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L232)

Sleep for a duration using WorkflowCore's timer management.
Integrates with WindowManager for efficient timer coalescing.

#### Parameters

##### name

`string`

##### durationMs

`number`

##### durationStr

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`WorkflowStorageStrategy`](../interfaces/WorkflowStorageStrategy.md).[`sleep`](../interfaces/WorkflowStorageStrategy.md#sleep)
