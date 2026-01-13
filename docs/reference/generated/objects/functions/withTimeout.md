[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / withTimeout

# Function: withTimeout()

> **withTimeout**\<`TInput`, `TOutput`\>(`fn`, `timeout`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

Defined in: [lib/functions/FunctionComposition.ts:555](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L555)

Wrap a function with timeout

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### fn

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

### timeout

`number`

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>
