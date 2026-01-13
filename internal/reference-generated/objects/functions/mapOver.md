[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / mapOver

# Function: mapOver()

> **mapOver**\<`TItem`, `TOutput`\>(`fn`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TItem`[], `TOutput`[]\>

Defined in: [lib/functions/FunctionComposition.ts:624](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L624)

Map over an array input, applying function to each element

## Type Parameters

### TItem

`TItem`

### TOutput

`TOutput`

## Parameters

### fn

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TItem`, `TOutput`\>

### options?

#### maxConcurrency?

`number`

#### parallel?

`boolean`

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TItem`[], `TOutput`[]\>
