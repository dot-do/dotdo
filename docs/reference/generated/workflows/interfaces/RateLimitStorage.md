[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitStorage

# Interface: RateLimitStorage

Defined in: [workflows/context/rate-limit.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L121)

Internal storage for rate limit state

## Properties

### configs

> **configs**: `Map`\<`string`, [`RateLimitConfig`](RateLimitConfig.md)\>

Defined in: [workflows/context/rate-limit.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L125)

Named limit configurations

***

### entries

> **entries**: `Map`\<`string`, `object`[]\>

Defined in: [workflows/context/rate-limit.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L123)

Request entries: compositeKey -> array of { timestamp, cost }
