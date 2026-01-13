[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / toolDefinitionToMcp

# Function: toolDefinitionToMcp()

> **toolDefinitionToMcp**(`toolDef`): [`McpTool`](../interfaces/McpTool.md)

Defined in: [types/mcp.ts:666](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L666)

Convert an agent ToolDefinition to MCP tool format.

This bridges the agents/ module with MCP, allowing agent tools
to be exposed via MCP transport.

## Parameters

### toolDef

[`AgentToolDefinition`](../interfaces/AgentToolDefinition.md)

The agent ToolDefinition

## Returns

[`McpTool`](../interfaces/McpTool.md)

MCP tool definition

## Example

```typescript
const mcpTool = toolDefinitionToMcp({
  name: 'search',
  description: 'Search items',
  inputSchema: z.object({ query: z.string() })
})
```
