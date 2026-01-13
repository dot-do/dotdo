[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitContextInstance

# Interface: RateLimitContextInstance

Defined in: [workflows/context/rate-limit.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L65)

Rate limit instance returned by $.rateLimit(key)

## Methods

### check()

> **check**(`options?`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [workflows/context/rate-limit.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L70)

Check if request is allowed and consume quota
Returns result with success status and remaining quota

#### Parameters

##### options?

[`RateLimitOptions`](RateLimitOptions.md)

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

***

### consume()

> **consume**(`cost`, `options?`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [workflows/context/rate-limit.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L85)

Consume specific cost from quota (for post-facto consumption)

#### Parameters

##### cost

`number`

##### options?

`Omit`\<[`RateLimitOptions`](RateLimitOptions.md), `"cost"`\>

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

***

### isAllowed()

> **isAllowed**(`options?`): `Promise`\<`boolean`\>

Defined in: [workflows/context/rate-limit.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L75)

Boolean check if request would be allowed (does not consume quota)

#### Parameters

##### options?

[`RateLimitOptions`](RateLimitOptions.md)

#### Returns

`Promise`\<`boolean`\>

***

### remaining()

> **remaining**(`options?`): `Promise`\<`number`\>

Defined in: [workflows/context/rate-limit.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L80)

Get remaining quota without consuming

#### Parameters

##### options?

[`RateLimitOptions`](RateLimitOptions.md)

#### Returns

`Promise`\<`number`\>

***

### reset()

> **reset**(`options?`): `Promise`\<`void`\>

Defined in: [workflows/context/rate-limit.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L90)

Reset the rate limit for this key

#### Parameters

##### options?

`Omit`\<[`RateLimitOptions`](RateLimitOptions.md), `"cost"`\>

#### Returns

`Promise`\<`void`\>

***

### status()

> **status**(`options?`): `Promise`\<[`RateLimitResult`](RateLimitResult.md)\>

Defined in: [workflows/context/rate-limit.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L95)

Get status without modifying quota

#### Parameters

##### options?

`Omit`\<[`RateLimitOptions`](RateLimitOptions.md), `"cost"`\>

#### Returns

`Promise`\<[`RateLimitResult`](RateLimitResult.md)\>
