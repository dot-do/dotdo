[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / unregisterHandler

# Function: unregisterHandler()

> **unregisterHandler**(`eventKey`, `handler`): `boolean`

Defined in: [workflows/on.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L235)

Unregister a specific handler by event key and handler reference

## Parameters

### eventKey

`string`

The event key (e.g., "Customer.signup")

### handler

`Function`

The handler function to remove

## Returns

`boolean`

true if handler was found and removed
