[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / reduceWith

# Function: reduceWith()

> **reduceWith**\<`TItem`, `TAcc`\>(`reducer`, `initial`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TItem`[], `TAcc`\>

Defined in: [lib/functions/FunctionComposition.ts:686](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L686)

Reduce array input to single value

## Type Parameters

### TItem

`TItem`

### TAcc

`TAcc`

## Parameters

### reducer

(`acc`, `item`, `context?`) => `TAcc` \| `Promise`\<`TAcc`\>

### initial

`TAcc`

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TItem`[], `TAcc`\>
