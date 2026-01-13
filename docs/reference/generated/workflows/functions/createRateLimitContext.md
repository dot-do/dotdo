[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createRateLimitContext

# Function: createRateLimitContext()

> **createRateLimitContext**(): [`RateLimitContext`](../interfaces/RateLimitContext.md)

Defined in: [workflows/context/rate-limit.ts:229](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L229)

Creates a mock workflow context ($) with rate limit support for testing

This factory creates a context object with:
- $.rateLimit(key) - Returns a RateLimitContextInstance for per-key operations
- $.rateLimits - Collection-level operations (configure, get, getConfig)
- $._storage - Internal storage for test setup
- $._now - Time provider for testing (can be overridden for fake timers)

## Returns

[`RateLimitContext`](../interfaces/RateLimitContext.md)

A RateLimitContext object with rate limit API methods
