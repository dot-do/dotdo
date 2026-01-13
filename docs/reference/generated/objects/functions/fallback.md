[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / fallback

# Function: fallback()

> **fallback**\<`TInput`, `TOutput`\>(`primary`, `alternative`, `shouldFallback?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

Defined in: [lib/functions/FunctionComposition.ts:576](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L576)

Try primary function, fall back to alternative on failure

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### primary

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

### alternative

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

### shouldFallback?

(`error`) => `boolean`

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>
