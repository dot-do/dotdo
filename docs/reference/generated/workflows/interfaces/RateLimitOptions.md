[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RateLimitOptions

# Interface: RateLimitOptions

Defined in: [workflows/context/rate-limit.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L55)

Options for rate limit operations

## Properties

### cost?

> `optional` **cost**: `number`

Defined in: [workflows/context/rate-limit.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L57)

Cost of this operation (default 1)

***

### name?

> `optional` **name**: `string`

Defined in: [workflows/context/rate-limit.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L59)

Named limit to use (e.g., 'api', 'ai', 'upload')
