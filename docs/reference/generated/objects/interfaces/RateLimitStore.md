[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RateLimitStore

# Interface: RateLimitStore

Defined in: [lib/functions/FunctionMiddleware.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L79)

## Properties

### check()

> **check**: (`key`) => `Promise`\<[`RateLimitInfo`](RateLimitInfo.md)\>

Defined in: [lib/functions/FunctionMiddleware.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L80)

#### Parameters

##### key

`string`

#### Returns

`Promise`\<[`RateLimitInfo`](RateLimitInfo.md)\>

***

### increment()

> **increment**: (`key`) => `Promise`\<`void`\>

Defined in: [lib/functions/FunctionMiddleware.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L81)

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`void`\>
