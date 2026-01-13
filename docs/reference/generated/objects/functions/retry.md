[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / retry

# Function: retry()

> **retry**\<`TInput`, `TOutput`\>(`fn`, `options`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

Defined in: [lib/functions/FunctionComposition.ts:501](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L501)

Wrap a function with retry logic

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### fn

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

### options

[`RetryOptions`](../interfaces/RetryOptions.md)

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>
