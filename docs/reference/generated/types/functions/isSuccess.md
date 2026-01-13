[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isSuccess

# Function: isSuccess()

> **isSuccess**\<`T`, `M`\>(`result`): `result is ExecutionResult<T, M> & { success: true; value: T }`

Defined in: [types/AIFunction.ts:931](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L931)

Check if an execution result is successful

## Type Parameters

### T

`T`

### M

`M` *extends* [`ExecutionMetrics`](../interfaces/ExecutionMetrics.md)

## Parameters

### result

[`ExecutionResult`](../interfaces/ExecutionResult.md)\<`T`, `M`\>

## Returns

`result is ExecutionResult<T, M> & { success: true; value: T }`
