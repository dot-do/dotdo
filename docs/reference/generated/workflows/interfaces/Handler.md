[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / Handler

# Interface: Handler\<T\>

Defined in: [workflows/domain.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L27)

A wrapped handler with both the function and its source code.
Generic over the handler function type to preserve type information.

## Type Parameters

### T

`T` *extends* `HandlerFunction` = `HandlerFunction`

## Properties

### fn

> **fn**: `T`

Defined in: [workflows/domain.ts:28](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L28)

***

### source

> **source**: `string`

Defined in: [workflows/domain.ts:29](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L29)
