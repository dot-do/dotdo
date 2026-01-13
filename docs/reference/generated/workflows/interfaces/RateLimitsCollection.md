[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitsCollection

# Interface: RateLimitsCollection

Defined in: [workflows/context/rate-limit.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L101)

Named rate limits collection at $.rateLimits

## Methods

### configure()

> **configure**(`name`, `config`): `void`

Defined in: [workflows/context/rate-limit.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L110)

Configure a named limit

#### Parameters

##### name

`string`

##### config

[`RateLimitConfig`](RateLimitConfig.md)

#### Returns

`void`

***

### get()

> **get**(`name`): [`RateLimitConfig`](RateLimitConfig.md) \| `undefined`

Defined in: [workflows/context/rate-limit.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L115)

Get configuration for a specific named limit

#### Parameters

##### name

`string`

#### Returns

[`RateLimitConfig`](RateLimitConfig.md) \| `undefined`

***

### getConfig()

> **getConfig**(): `Record`\<`string`, [`RateLimitConfig`](RateLimitConfig.md)\>

Defined in: [workflows/context/rate-limit.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L105)

Get all configured named limits

#### Returns

`Record`\<`string`, [`RateLimitConfig`](RateLimitConfig.md)\>
