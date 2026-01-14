[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createFlagContext

# Function: createFlagContext()

> **createFlagContext**(): [`FlagContext`](../interfaces/FlagContext.md)

Defined in: [workflows/context/flag.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L220)

Creates a mock workflow context ($) with flag support for testing

This factory creates a context object with:
- $.flag(id) - Returns a FlagContextInstance for per-flag operations
- $.flags - Collection-level operations (fetch, evaluate)
- $._storage - Internal storage for test setup

## Returns

[`FlagContext`](../interfaces/FlagContext.md)

A FlagContext object with flag API methods
