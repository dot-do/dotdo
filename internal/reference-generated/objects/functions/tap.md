[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / tap

# Function: tap()

> **tap**\<`T`\>(`sideEffect`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `T`\>

Defined in: [lib/functions/FunctionComposition.ts:708](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L708)

Execute side effect without modifying input

## Type Parameters

### T

`T`

## Parameters

### sideEffect

(`input`, `context?`) => `void` \| `Promise`\<`void`\>

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `T`\>
