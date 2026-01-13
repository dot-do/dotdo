[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CacheOptions

# Interface: CacheOptions

Defined in: [lib/functions/FunctionMiddleware.ts:502](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L502)

## Properties

### keyGenerator()?

> `optional` **keyGenerator**: (`ctx`) => `string`

Defined in: [lib/functions/FunctionMiddleware.ts:504](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L504)

#### Parameters

##### ctx

[`MiddlewareContext`](MiddlewareContext.md)

#### Returns

`string`

***

### shouldCache()?

> `optional` **shouldCache**: (`ctx`, `result`) => `boolean`

Defined in: [lib/functions/FunctionMiddleware.ts:506](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L506)

#### Parameters

##### ctx

[`MiddlewareContext`](MiddlewareContext.md)

##### result

`unknown`

#### Returns

`boolean`

***

### store

> **store**: [`CacheStore`](CacheStore.md)

Defined in: [lib/functions/FunctionMiddleware.ts:503](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L503)

***

### ttl

> **ttl**: `number`

Defined in: [lib/functions/FunctionMiddleware.ts:505](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L505)
