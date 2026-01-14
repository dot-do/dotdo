[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / parallelWithResults

# Function: parallelWithResults()

> **parallelWithResults**\<`T`, `R`\>(`functions`, `options?`): (`input`, `context?`) => `Promise`\<[`ParallelResult`](../interfaces/ParallelResult.md)\<`R`\>\>

Defined in: [lib/functions/FunctionComposition.ts:390](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L390)

Execute parallel functions and get detailed results

## Type Parameters

### T

`T`

### R

`R` *extends* `unknown`[]

## Parameters

### functions

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `unknown`\>[]

### options?

[`ParallelOptions`](../interfaces/ParallelOptions.md)

## Returns

> (`input`, `context?`): `Promise`\<[`ParallelResult`](../interfaces/ParallelResult.md)\<`R`\>\>

### Parameters

#### input

`T`

#### context?

[`CompositionExecutionContext`](../interfaces/CompositionExecutionContext.md)

### Returns

`Promise`\<[`ParallelResult`](../interfaces/ParallelResult.md)\<`R`\>\>
