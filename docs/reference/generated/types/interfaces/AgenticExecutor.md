[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AgenticExecutor

# Interface: AgenticExecutor()

Defined in: [types/AIFunction.ts:780](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L780)

Executor for agentic functions

> **AgenticExecutor**\<`Input`, `Output`\>(`definition`): [`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`AgenticExecutionResult`](../type-aliases/AgenticExecutionResult.md)\<`Output`\>, `Input`, [`AgenticOptions`](AgenticOptions.md)\>

Defined in: [types/AIFunction.ts:781](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L781)

Executor for agentic functions

## Type Parameters

### Input

`Input`

### Output

`Output`

## Parameters

### definition

[`AgenticFunctionDefinition`](AgenticFunctionDefinition.md)\<`Input`, `Output`\>

## Returns

[`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`AgenticExecutionResult`](../type-aliases/AgenticExecutionResult.md)\<`Output`\>, `Input`, [`AgenticOptions`](AgenticOptions.md)\>
