[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GenerativeExecutor

# Interface: GenerativeExecutor()

Defined in: [types/AIFunction.ts:771](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L771)

Executor for generative functions

> **GenerativeExecutor**\<`Input`, `Output`\>(`definition`): [`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`GenerativeExecutionResult`](../type-aliases/GenerativeExecutionResult.md)\<`Output`\>, `Input`, [`GenerativeOptions`](GenerativeOptions.md)\>

Defined in: [types/AIFunction.ts:772](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L772)

Executor for generative functions

## Type Parameters

### Input

`Input`

### Output

`Output`

## Parameters

### definition

[`GenerativeFunctionDefinition`](GenerativeFunctionDefinition.md)\<`Input`, `Output`\>

## Returns

[`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`GenerativeExecutionResult`](../type-aliases/GenerativeExecutionResult.md)\<`Output`\>, `Input`, [`GenerativeOptions`](GenerativeOptions.md)\>
