[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ResultForType

# Type Alias: ResultForType\<T, Output\>

> **ResultForType**\<`T`, `Output`\> = `T` *extends* `"code"` ? [`CodeExecutionResult`](CodeExecutionResult.md)\<`Output`\> : `T` *extends* `"generative"` ? [`GenerativeExecutionResult`](GenerativeExecutionResult.md)\<`Output`\> : `T` *extends* `"agentic"` ? [`AgenticExecutionResult`](AgenticExecutionResult.md)\<`Output`\> : `T` *extends* `"human"` ? [`HumanExecutionResult`](HumanExecutionResult.md)\<`Output`\> : [`ExecutionResult`](../interfaces/ExecutionResult.md)\<`Output`\>

Defined in: [types/AIFunction.ts:964](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L964)

Get the result type for a function type

## Type Parameters

### T

`T` *extends* [`FunctionType`](FunctionType.md)

### Output

`Output`
