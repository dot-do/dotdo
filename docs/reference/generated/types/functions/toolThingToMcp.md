[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / toolThingToMcp

# Function: toolThingToMcp()

> **toolThingToMcp**(`toolThing`): [`McpTool`](../interfaces/McpTool.md)

Defined in: [types/mcp.ts:553](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/mcp.ts#L553)

Convert a Tool Thing from the graph to MCP tool format.

## Parameters

### toolThing

The GraphThing representing a Tool

#### data

`Record`\<`string`, `unknown`\> \| `null`

#### id

`string`

## Returns

[`McpTool`](../interfaces/McpTool.md)

MCP tool definition

## Example

```typescript
const mcpTool = toolThingToMcp({
  id: 'search',
  data: {
    id: 'search',
    description: 'Search items',
    parameters: [{ name: 'query', type: 'string', required: true }]
  }
})
```
