[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DoOptions

# Interface: DoOptions

Defined in: [types/WorkflowContext.ts:254](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L254)

Options for $.do() durable execution

## Properties

### retry?

> `optional` **retry**: `Partial`\<[`RetryPolicy`](RetryPolicy.md)\>

Defined in: [types/WorkflowContext.ts:256](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L256)

Custom retry policy (merged with defaults)

***

### stepId?

> `optional` **stepId**: `string`

Defined in: [types/WorkflowContext.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L260)

Explicit step ID for workflow integration and replay

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/WorkflowContext.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L258)

Timeout per attempt in milliseconds
