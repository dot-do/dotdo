[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CacheConfig

# Interface: CacheConfig

Defined in: [types/AIFunction.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L273)

Cache configuration for function results

## Properties

### keyFn()?

> `optional` **keyFn**: (`input`) => `string`

Defined in: [types/AIFunction.ts:277](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L277)

Cache key generator

#### Parameters

##### input

`unknown`

#### Returns

`string`

***

### namespace?

> `optional` **namespace**: `string`

Defined in: [types/AIFunction.ts:281](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L281)

Cache namespace

***

### staleWhileRevalidate?

> `optional` **staleWhileRevalidate**: `boolean`

Defined in: [types/AIFunction.ts:279](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L279)

Whether to use stale-while-revalidate

***

### ttlSeconds?

> `optional` **ttlSeconds**: `number`

Defined in: [types/AIFunction.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L275)

Time-to-live in seconds
