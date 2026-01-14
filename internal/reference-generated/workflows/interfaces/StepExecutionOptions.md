[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / StepExecutionOptions

# Interface: StepExecutionOptions

Defined in: [workflows/core/workflow-core-storage.ts:36](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L36)

Options for step execution

## Properties

### retries?

> `optional` **retries**: `object`

Defined in: [workflows/core/workflow-core-storage.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L40)

Retry configuration

#### backoff?

> `optional` **backoff**: `"exponential"` \| `"linear"` \| `"constant"`

#### delay?

> `optional` **delay**: `string` \| `number`

#### limit?

> `optional` **limit**: `number`

***

### timeout?

> `optional` **timeout**: `string` \| `number`

Defined in: [workflows/core/workflow-core-storage.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L38)

Timeout for the step (duration string or ms)
