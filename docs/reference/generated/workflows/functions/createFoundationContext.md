[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createFoundationContext

# Function: createFoundationContext()

> **createFoundationContext**(): [`FoundationContext`](../interfaces/FoundationContext.md)

Defined in: [workflows/context/foundation.ts:1093](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L1093)

Creates a mock workflow context ($) with foundation support for testing

This factory creates a context object with:
- $.foundation() - Returns a FoundationBuilder for foundation sprint workflow
- $._storage - Internal storage for test setup

## Returns

[`FoundationContext`](../interfaces/FoundationContext.md)

A FoundationContext object with foundation API methods
