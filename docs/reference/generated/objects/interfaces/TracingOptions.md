[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / TracingOptions

# Interface: TracingOptions

Defined in: [lib/functions/FunctionMiddleware.ts:627](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L627)

## Properties

### extractTraceContext()?

> `optional` **extractTraceContext**: (`ctx`) => `object`

Defined in: [lib/functions/FunctionMiddleware.ts:629](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L629)

#### Parameters

##### ctx

[`MiddlewareContext`](MiddlewareContext.md)

#### Returns

`object`

##### parentSpanId?

> `optional` **parentSpanId**: `string`

##### traceId?

> `optional` **traceId**: `string`

***

### sink

> **sink**: [`TraceSink`](../type-aliases/TraceSink.md)

Defined in: [lib/functions/FunctionMiddleware.ts:628](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L628)
