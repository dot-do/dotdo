[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowRunThing

# Interface: WorkflowRunThing

Defined in: [workflows/core/graph-runtime-state.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L51)

Thing representation for a workflow run

## Properties

### $id

> **$id**: `string`

Defined in: [workflows/core/graph-runtime-state.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L52)

***

### $type

> **$type**: `"WorkflowRun"`

Defined in: [workflows/core/graph-runtime-state.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L53)

***

### createdAt

> **createdAt**: `number`

Defined in: [workflows/core/graph-runtime-state.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L72)

***

### data

> **data**: `object`

Defined in: [workflows/core/graph-runtime-state.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L54)

#### completedAt?

> `optional` **completedAt**: `string`

#### currentStepIndex

> **currentStepIndex**: `number`

#### description?

> `optional` **description**: `string`

#### error?

> `optional` **error**: `object`

##### error.message

> **message**: `string`

##### error.name

> **name**: `string`

##### error.stack?

> `optional` **stack**: `string`

#### input?

> `optional` **input**: `unknown`

#### instanceId

> **instanceId**: `string`

#### name

> **name**: `string`

#### output?

> `optional` **output**: `unknown`

#### pendingEvents

> **pendingEvents**: `string`[]

#### startedAt?

> `optional` **startedAt**: `string`

#### status

> **status**: [`WorkflowRuntimeStatus`](../type-aliases/WorkflowRuntimeStatus.md)

#### version?

> `optional` **version**: `string`

***

### updatedAt

> **updatedAt**: `number`

Defined in: [workflows/core/graph-runtime-state.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L73)
