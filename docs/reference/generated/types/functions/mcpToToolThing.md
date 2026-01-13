[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / mcpToToolThing

# Function: mcpToToolThing()

> **mcpToToolThing**(`mcpTool`): [`ToolThingData`](../interfaces/ToolThingData.md)

Defined in: [types/mcp.ts:613](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L613)

Convert an MCP tool back to ToolThing data format.

Useful for storing MCP tools in the graph.

## Parameters

### mcpTool

[`McpTool`](../interfaces/McpTool.md)

The MCP tool definition

## Returns

[`ToolThingData`](../interfaces/ToolThingData.md)

Partial ToolThingData suitable for graph storage

## Example

```typescript
const thingData = mcpToToolThing({
  name: 'search',
  description: 'Search items',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query']
  }
})
```
