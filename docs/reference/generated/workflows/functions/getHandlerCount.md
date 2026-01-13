[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / getHandlerCount

# Function: getHandlerCount()

> **getHandlerCount**(`context?`): `number`

Defined in: [workflows/on.ts:170](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L170)

Get total count of registered handlers across all events.
If context is provided, only counts handlers registered with that context.

## Parameters

### context?

`string`

Optional context to filter handlers by (e.g., DO namespace)

## Returns

`number`

Total handler count
