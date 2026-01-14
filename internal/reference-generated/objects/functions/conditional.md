[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / conditional

# Function: conditional()

> **conditional**\<`TInput`, `TOutput`\>(`predicate`, `onTrue`, `onFalse?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput` \| `undefined`\>

Defined in: [lib/functions/FunctionComposition.ts:445](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L445)

Execute a function conditionally based on predicate

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### predicate

(`input`) => `boolean` \| `Promise`\<`boolean`\>

### onTrue

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

### onFalse?

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput`\>

## Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`TInput`, `TOutput` \| `undefined`\>
