[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitConfig

# Interface: RateLimitConfig

Defined in: [workflows/context/rate-limit.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L43)

Configuration for a named rate limit

## Properties

### description?

> `optional` **description**: `string`

Defined in: [workflows/context/rate-limit.ts:49](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L49)

Optional: description of this limit

***

### limit

> **limit**: `number`

Defined in: [workflows/context/rate-limit.ts:45](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L45)

Maximum requests/units allowed in the window

***

### window

> **window**: `string`

Defined in: [workflows/context/rate-limit.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L47)

Window duration (e.g., '1m', '1h', '1d')
