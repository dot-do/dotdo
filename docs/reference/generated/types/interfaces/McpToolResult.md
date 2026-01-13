[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpToolResult

# Interface: McpToolResult

Defined in: [types/mcp.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L97)

Result of invoking an MCP tool

## Properties

### content

> **content**: [`McpContent`](McpContent.md)[]

Defined in: [types/mcp.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L99)

Array of content blocks in the result

***

### isError?

> `optional` **isError**: `boolean`

Defined in: [types/mcp.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L101)

If true, the result represents an error condition
