[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / getRegisteredHandlers

# Function: getRegisteredHandlers()

> **getRegisteredHandlers**(`eventKey`, `context?`): `Function`[]

Defined in: [workflows/on.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L148)

Get all registered handlers for an event key.
If context is provided, only returns handlers registered with that context.

## Parameters

### eventKey

`string`

The event key (e.g., "Customer.signup")

### context?

`string`

Optional context to filter handlers by (e.g., DO namespace)

## Returns

`Function`[]

Array of handler functions
