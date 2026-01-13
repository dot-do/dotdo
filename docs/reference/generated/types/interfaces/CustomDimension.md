[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CustomDimension

# Interface: CustomDimension\<T\>

Defined in: [types/event.ts:219](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L219)

CustomDimension - A user-defined dimension for events
Allows extending the 5W+H model with domain-specific context

## Type Parameters

### T

`T` = `unknown`

## Properties

### key

> **key**: `string`

Defined in: [types/event.ts:223](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L223)

Dimension key

***

### namespace

> **namespace**: `string`

Defined in: [types/event.ts:221](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L221)

Dimension namespace (e.g., "custom:", "epcis:", "domain:")

***

### schema?

> `optional` **schema**: `string`

Defined in: [types/event.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L227)

Optional schema reference for validation

***

### value

> **value**: `T`

Defined in: [types/event.ts:225](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/event.ts#L225)

Dimension value
