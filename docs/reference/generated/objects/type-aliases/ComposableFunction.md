[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ComposableFunction

# Type Alias: ComposableFunction()\<TInput, TOutput\>

> **ComposableFunction**\<`TInput`, `TOutput`\> = (`input`, `context?`) => `TOutput` \| `Promise`\<`TOutput`\>

Defined in: [lib/functions/FunctionComposition.ts:17](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L17)

FunctionComposition

Utilities for composing functions together:
- pipe: Execute functions sequentially, passing output to next input
- parallel: Execute functions concurrently, combine results
- conditional: Execute based on condition
- retry: Wrap with retry logic
- timeout: Wrap with timeout
- fallback: Try primary, fall back to alternative on failure

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Parameters

### input

`TInput`

### context?

[`CompositionExecutionContext`](../interfaces/CompositionExecutionContext.md)

## Returns

`TOutput` \| `Promise`\<`TOutput`\>
