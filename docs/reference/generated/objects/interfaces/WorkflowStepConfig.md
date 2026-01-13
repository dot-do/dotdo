[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowStepConfig

# Interface: WorkflowStepConfig

Defined in: [objects/WorkflowRuntime.ts:134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L134)

## Properties

### modifiers?

> `optional` **modifiers**: [`Modifier`](Modifier.md)\<`unknown`, `unknown`\>[]

Defined in: [objects/WorkflowRuntime.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L142)

Modifiers to transform input/output

***

### retries?

> `optional` **retries**: `number`

Defined in: [objects/WorkflowRuntime.ts:138](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L138)

Number of retries

***

### retryDelay?

> `optional` **retryDelay**: `string` \| `number`

Defined in: [objects/WorkflowRuntime.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L140)

Delay between retries

***

### timeout?

> `optional` **timeout**: `string` \| `number`

Defined in: [objects/WorkflowRuntime.ts:136](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L136)

Step timeout
