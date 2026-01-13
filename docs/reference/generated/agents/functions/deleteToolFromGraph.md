[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / deleteToolFromGraph

# Function: deleteToolFromGraph()

> **deleteToolFromGraph**(`store`, `name`): `Promise`\<`boolean`\>

Defined in: [agents/tool-thing.ts:419](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L419)

Delete a tool from the graph store.

Removes the Tool Thing from the graph and unregisters its handler.

## Parameters

### store

`GraphStore`

The graph store

### name

`string`

The tool name to delete

## Returns

`Promise`\<`boolean`\>

true if deleted, false if not found
