[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ExecutionMiddleware

# Type Alias: ExecutionMiddleware()\<TInput, TOutput\>

> **ExecutionMiddleware**\<`TInput`, `TOutput`\> = (`ctx`, `next`) => `Promise`\<`TOutput`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L125)

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Parameters

### ctx

[`MiddlewareContext`](../interfaces/MiddlewareContext.md)\<`TInput`\>

### next

[`MiddlewareNext`](MiddlewareNext.md)\<`TOutput`\>

## Returns

`Promise`\<`TOutput`\>
