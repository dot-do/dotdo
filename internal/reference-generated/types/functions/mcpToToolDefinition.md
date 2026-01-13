[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / mcpToToolDefinition

# Function: mcpToToolDefinition()

> **mcpToToolDefinition**(`mcpTool`): [`AgentToolDefinition`](../interfaces/AgentToolDefinition.md)

Defined in: [types/mcp.ts:706](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L706)

Convert an MCP tool to agent ToolDefinition format (partial).

Returns a partial definition without the execute function,
which must be provided separately.

## Parameters

### mcpTool

[`McpTool`](../interfaces/McpTool.md)

The MCP tool definition

## Returns

[`AgentToolDefinition`](../interfaces/AgentToolDefinition.md)

Partial agent ToolDefinition
