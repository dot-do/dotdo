[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / getHandler

# Function: getHandler()

> **getHandler**(`id`): (`input`, `context`) => `Promise`\<`unknown`\> \| `undefined`

Defined in: [agents/tool-thing.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L75)

Get a handler function by ID.

## Parameters

### id

`string`

The handler ID from registerHandler

## Returns

(`input`, `context`) => `Promise`\<`unknown`\> \| `undefined`

The handler function or undefined if not found
