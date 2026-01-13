[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / McpToolWithHandler

# Interface: McpToolWithHandler

Defined in: [types/mcp.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L74)

MCP Tool with handler (for tool registration)

## Extends

- [`McpTool`](McpTool.md)

## Properties

### description

> **description**: `string`

Defined in: [types/mcp.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L57)

Human-readable description of what the tool does

#### Inherited from

[`McpTool`](McpTool.md).[`description`](McpTool.md#description)

***

### handler

> **handler**: [`McpToolHandler`](../type-aliases/McpToolHandler.md)

Defined in: [types/mcp.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L76)

Async function that implements the tool's functionality

***

### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\> \| [`McpToolInputSchema`](McpToolInputSchema.md)

Defined in: [types/mcp.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L59)

JSON Schema for the tool's input parameters

#### Inherited from

[`McpTool`](McpTool.md).[`inputSchema`](McpTool.md#inputschema)

***

### name

> **name**: `string`

Defined in: [types/mcp.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L55)

Unique name identifying the tool (e.g., 'search', 'create_thing')

#### Inherited from

[`McpTool`](McpTool.md).[`name`](McpTool.md#name)
