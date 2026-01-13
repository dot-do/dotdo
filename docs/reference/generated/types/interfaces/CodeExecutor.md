[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CodeExecutor

# Interface: CodeExecutor()

Defined in: [types/AIFunction.ts:762](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L762)

Executor for code functions

> **CodeExecutor**\<`Input`, `Output`\>(`definition`): [`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`CodeExecutionResult`](../type-aliases/CodeExecutionResult.md)\<`Output`\>, `Input`, [`CodeOptions`](CodeOptions.md)\>

Defined in: [types/AIFunction.ts:763](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L763)

Executor for code functions

## Type Parameters

### Input

`Input`

### Output

`Output`

## Parameters

### definition

[`CodeFunctionDefinition`](CodeFunctionDefinition.md)\<`Input`, `Output`\>

## Returns

[`ExecutorFn`](../type-aliases/ExecutorFn.md)\<[`CodeExecutionResult`](../type-aliases/CodeExecutionResult.md)\<`Output`\>, `Input`, [`CodeOptions`](CodeOptions.md)\>
