[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitContext

# Interface: RateLimitContext

Defined in: [workflows/context/rate-limit.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L131)

Full context interface returned by createMockContext

## Properties

### \_now()

> **\_now**: () => `number`

Defined in: [workflows/context/rate-limit.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L135)

#### Returns

`number`

***

### \_storage

> **\_storage**: [`RateLimitStorage`](RateLimitStorage.md)

Defined in: [workflows/context/rate-limit.ts:134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L134)

***

### rateLimit()

> **rateLimit**: (`key`) => [`RateLimitContextInstance`](RateLimitContextInstance.md)

Defined in: [workflows/context/rate-limit.ts:132](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L132)

#### Parameters

##### key

`string`

#### Returns

[`RateLimitContextInstance`](RateLimitContextInstance.md)

***

### rateLimits

> **rateLimits**: [`RateLimitsCollection`](RateLimitsCollection.md)

Defined in: [workflows/context/rate-limit.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L133)
