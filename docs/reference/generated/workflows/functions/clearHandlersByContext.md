[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / clearHandlersByContext

# Function: clearHandlersByContext()

> **clearHandlersByContext**(`context`): `number`

Defined in: [workflows/on.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L204)

Clear all handlers registered under a specific context
Use this when a Durable Object is being destroyed

## Parameters

### context

`string`

The context identifier (e.g., DO namespace)

## Returns

`number`

Number of handlers removed
