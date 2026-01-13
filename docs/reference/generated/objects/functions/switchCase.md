[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / switchCase

# Function: switchCase()

> **switchCase**\<`TInput`, `TOutput`, `K`\>(`discriminator`, `cases`, `defaultCase?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput` \| `undefined`\>

Defined in: [lib/functions/FunctionComposition.ts:468](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L468)

Switch between multiple functions based on a discriminator

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

### K

`K` *extends* `string` \| `number`

## Parameters

### discriminator

(`input`) => `K` \| `Promise`\<`K`\>

### cases

`Record`\<`K`, [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>\>

### defaultCase?

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput` \| `undefined`\>
