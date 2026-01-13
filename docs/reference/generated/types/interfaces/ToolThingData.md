[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ToolThingData

# Interface: ToolThingData

Defined in: [types/mcp.ts:512](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L512)

Tool definition stored as a Thing in the graph.
This is the structure stored in GraphThing.data.

Index signature allows safe assignment from Record<string, unknown>
in type guards while maintaining type safety for known fields.

## Indexable

\[`key`: `string`\]: `unknown`

Index signature for compatibility with Record<string, unknown>

## Properties

### description

> **description**: `string`

Defined in: [types/mcp.ts:514](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L514)

***

### handler?

> `optional` **handler**: `string`

Defined in: [types/mcp.ts:516](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L516)

***

### id

> **id**: `string`

Defined in: [types/mcp.ts:513](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L513)

***

### parameters

> **parameters**: [`ToolParameter`](ToolParameter.md)[]

Defined in: [types/mcp.ts:515](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L515)
