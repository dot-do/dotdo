[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / loadToolFromGraph

# Function: loadToolFromGraph()

> **loadToolFromGraph**(`store`, `name`): `Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`\>

Defined in: [agents/tool-thing.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L361)

Load a tool from the graph store.

Retrieves a Tool Thing from the graph and converts it back to
a ToolDefinition. The execute handler must have been previously
registered (e.g., by calling persistentTool with the same tool).

## Parameters

### store

`GraphStore`

The graph store to load from

### name

`string`

The tool name

## Returns

`Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`\>

The ToolDefinition or null if not found

## Example

```typescript
const tool = await loadToolFromGraph(graphStore, 'getWeather')
if (tool) {
  const result = await tool.execute({ location: 'SF' }, ctx)
}
```
