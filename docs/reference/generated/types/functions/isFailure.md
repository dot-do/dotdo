[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isFailure

# Function: isFailure()

> **isFailure**\<`T`, `M`\>(`result`): `result is ExecutionResult<T, M> & { error: AIFunctionError; success: false }`

Defined in: [types/AIFunction.ts:938](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L938)

Check if an execution result is a failure

## Type Parameters

### T

`T`

### M

`M` *extends* [`ExecutionMetrics`](../interfaces/ExecutionMetrics.md)

## Parameters

### result

[`ExecutionResult`](../interfaces/ExecutionResult.md)\<`T`, `M`\>

## Returns

`result is ExecutionResult<T, M> & { error: AIFunctionError; success: false }`
