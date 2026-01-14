[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CacheStore

# Interface: CacheStore\<T\>

Defined in: [lib/functions/FunctionMiddleware.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L67)

## Type Parameters

### T

`T` = `unknown`

## Properties

### delete()

> **delete**: (`key`) => `void` \| `Promise`\<`void`\>

Defined in: [lib/functions/FunctionMiddleware.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L70)

#### Parameters

##### key

`string`

#### Returns

`void` \| `Promise`\<`void`\>

***

### get()

> **get**: (`key`) => [`CacheEntry`](CacheEntry.md)\<`T`\> \| `Promise`\<[`CacheEntry`](CacheEntry.md)\<`T`\> \| `undefined`\> \| `undefined`

Defined in: [lib/functions/FunctionMiddleware.ts:68](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L68)

#### Parameters

##### key

`string`

#### Returns

[`CacheEntry`](CacheEntry.md)\<`T`\> \| `Promise`\<[`CacheEntry`](CacheEntry.md)\<`T`\> \| `undefined`\> \| `undefined`

***

### set()

> **set**: (`key`, `entry`) => `void` \| `Promise`\<`void`\>

Defined in: [lib/functions/FunctionMiddleware.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L69)

#### Parameters

##### key

`string`

##### entry

[`CacheEntry`](CacheEntry.md)\<`T`\>

#### Returns

`void` \| `Promise`\<`void`\>
