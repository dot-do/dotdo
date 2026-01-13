[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RateLimitOptions

# Interface: RateLimitOptions

Defined in: [lib/functions/FunctionMiddleware.ts:422](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L422)

## Properties

### keyGenerator()?

> `optional` **keyGenerator**: (`ctx`) => `string`

Defined in: [lib/functions/FunctionMiddleware.ts:424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L424)

#### Parameters

##### ctx

[`MiddlewareContext`](MiddlewareContext.md)

#### Returns

`string`

***

### onLimit()?

> `optional` **onLimit**: (`ctx`, `info`) => `void`

Defined in: [lib/functions/FunctionMiddleware.ts:425](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L425)

#### Parameters

##### ctx

[`MiddlewareContext`](MiddlewareContext.md)

##### info

[`RateLimitInfo`](RateLimitInfo.md)

#### Returns

`void`

***

### store

> **store**: [`RateLimitStore`](RateLimitStore.md)

Defined in: [lib/functions/FunctionMiddleware.ts:423](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L423)
