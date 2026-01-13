[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowStorageStrategy

# Interface: WorkflowStorageStrategy

Defined in: [workflows/core/workflow-core-storage.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L58)

Storage strategy interface that matches the existing compat layer patterns.
This is the contract that WorkflowCoreStorageStrategy implements.

## Methods

### executeStep()

> **executeStep**\<`T`\>(`name`, `fn`, `options?`): `Promise`\<`T`\>

Defined in: [workflows/core/workflow-core-storage.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L62)

Execute a step with automatic caching and optional durability.

#### Type Parameters

##### T

`T`

#### Parameters

##### name

`string`

##### fn

() => `T` \| `Promise`\<`T`\>

##### options?

[`StepExecutionOptions`](StepExecutionOptions.md)

#### Returns

`Promise`\<`T`\>

***

### getStepResult()

> **getStepResult**\<`T`\>(`name`): `Promise`\<`T` \| `undefined`\>

Defined in: [workflows/core/workflow-core-storage.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L77)

Get the cached result of a completed step.

#### Type Parameters

##### T

`T`

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`T` \| `undefined`\>

***

### isStepCompleted()

> **isStepCompleted**(`name`): `Promise`\<`boolean`\>

Defined in: [workflows/core/workflow-core-storage.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L72)

Check if a step has been completed.

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`boolean`\>

***

### setStepResult()

> **setStepResult**(`name`, `result`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core-storage.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L82)

Store a step result (for replay).

#### Parameters

##### name

`string`

##### result

`unknown`

#### Returns

`Promise`\<`void`\>

***

### sleep()

> **sleep**(`name`, `durationMs`, `durationStr`): `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core-storage.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L67)

Sleep for a duration (using WorkflowCore timer management).

#### Parameters

##### name

`string`

##### durationMs

`number`

##### durationStr

`string`

#### Returns

`Promise`\<`void`\>
