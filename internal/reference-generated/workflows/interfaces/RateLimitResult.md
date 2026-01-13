[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitResult

# Interface: RateLimitResult

Defined in: [workflows/context/rate-limit.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L27)

Result from rate limit check/consume operations

## Properties

### cost?

> `optional` **cost**: `number`

Defined in: [workflows/context/rate-limit.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L37)

Cost that was consumed

***

### limit?

> `optional` **limit**: `number`

Defined in: [workflows/context/rate-limit.ts:35](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L35)

Limit that was checked

***

### remaining

> **remaining**: `number`

Defined in: [workflows/context/rate-limit.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L31)

Remaining quota in the current window

***

### resetAt?

> `optional` **resetAt**: `number`

Defined in: [workflows/context/rate-limit.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L33)

When the limit resets (epoch ms)

***

### success

> **success**: `boolean`

Defined in: [workflows/context/rate-limit.ts:29](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L29)

Whether the action is allowed
