[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HumanExecutor

# Interface: HumanExecutor()

Defined in: [types/AIFunction.ts:789](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L789)

Executor for human functions

> **HumanExecutor**\<`Input`, `Output`\>(`definition`): [`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`HumanExecutionResult`](../type-aliases/HumanExecutionResult.md)\<`Output`\>, `Input`, [`HumanOptions`](HumanOptions.md)\>

Defined in: [types/AIFunction.ts:790](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L790)

Executor for human functions

## Type Parameters

### Input

`Input`

### Output

`Output`

## Parameters

### definition

[`HumanFunctionDefinition`](HumanFunctionDefinition.md)\<`Input`, `Output`\>

## Returns

[`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`HumanExecutionResult`](../type-aliases/HumanExecutionResult.md)\<`Output`\>, `Input`, [`HumanOptions`](HumanOptions.md)\>
