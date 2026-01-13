[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpTool

# Interface: McpTool

Defined in: [types/mcp.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L53)

MCP Tool definition as returned by tools/list

This is the canonical type for MCP tools across the codebase.
Different components may use subset interfaces for their specific needs.

## Extended by

- [`McpToolWithHandler`](McpToolWithHandler.md)

## Properties

### description

> **description**: `string`

Defined in: [types/mcp.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L57)

Human-readable description of what the tool does

***

### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\> \| [`McpToolInputSchema`](McpToolInputSchema.md)

Defined in: [types/mcp.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L59)

JSON Schema for the tool's input parameters

***

### name

> **name**: `string`

Defined in: [types/mcp.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L55)

Unique name identifying the tool (e.g., 'search', 'create_thing')
