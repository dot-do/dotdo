[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowStepThing

# Interface: WorkflowStepThing

Defined in: [workflows/core/graph-runtime-state.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L79)

Thing representation for a workflow step

## Properties

### $id

> **$id**: `string`

Defined in: [workflows/core/graph-runtime-state.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L80)

***

### $type

> **$type**: `"WorkflowStep"`

Defined in: [workflows/core/graph-runtime-state.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L81)

***

### createdAt

> **createdAt**: `number`

Defined in: [workflows/core/graph-runtime-state.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L112)

***

### data

> **data**: `object`

Defined in: [workflows/core/graph-runtime-state.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L82)

#### completedAt?

> `optional` **completedAt**: `string`

#### duration?

> `optional` **duration**: `number`

#### error?

> `optional` **error**: `object`

##### error.message

> **message**: `string`

##### error.name

> **name**: `string`

##### error.stack?

> `optional` **stack**: `string`

#### index

> **index**: `number`

#### isParallel?

> `optional` **isParallel**: `boolean`

#### name

> **name**: `string`

#### output?

> `optional` **output**: `unknown`

#### parallelResults?

> `optional` **parallelResults**: `Record`\<`string`, \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `name`: `string`; `output?`: `unknown`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\>

#### retryCount?

> `optional` **retryCount**: `number`

#### startedAt?

> `optional` **startedAt**: `string`

#### status

> **status**: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md)

***

### updatedAt

> **updatedAt**: `number`

Defined in: [workflows/core/graph-runtime-state.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L113)
