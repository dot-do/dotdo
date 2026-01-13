[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / tryEach

# Function: tryEach()

> **tryEach**\<`TInput`, `TOutput`\>(...`fns`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

Defined in: [lib/functions/FunctionComposition.ts:599](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L599)

Try multiple functions in order until one succeeds

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### fns

...[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>[]

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>
