[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / BaseExecutionResult

# Interface: BaseExecutionResult\<T\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L99)

## Type Parameters

### T

`T` = `unknown`

## Properties

### duration

> **duration**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L103)

***

### error?

> `optional` **error**: `Error`

Defined in: [lib/executors/BaseFunctionExecutor.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L102)

***

### metrics

> **metrics**: [`ExecutionMetrics`](ExecutionMetrics.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L105)

***

### result?

> `optional` **result**: `T`

Defined in: [lib/executors/BaseFunctionExecutor.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L101)

***

### retryCount

> **retryCount**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L104)

***

### success

> **success**: `boolean`

Defined in: [lib/executors/BaseFunctionExecutor.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L100)
