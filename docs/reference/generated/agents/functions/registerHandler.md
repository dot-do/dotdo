[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / registerHandler

# Function: registerHandler()

> **registerHandler**\<`TInput`, `TOutput`\>(`toolName`, `handler`): `string`

Defined in: [agents/tool-thing.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L60)

Register a handler function and return its ID.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### toolName

`string`

Name of the tool (used for ID generation)

### handler

(`input`, `context`) => `Promise`\<`TOutput`\>

The execute function to register

## Returns

`string`

The handler ID for later retrieval
