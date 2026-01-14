[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / persistentTool

# Function: persistentTool()

> **persistentTool**\<`TInput`, `TOutput`\>(`options`): `Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>\>

Defined in: [agents/tool-thing.ts:310](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L310)

Create a tool definition and optionally persist it to a graph store.

This is the unified entry point that combines the agents/Tool.ts
functionality with graph persistence. If a store is provided,
the tool will be persisted as a Thing in the graph.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### options

[`PersistentToolOptions`](../interfaces/PersistentToolOptions.md)\<`TInput`, `TOutput`\>

Tool options including optional graph store

## Returns

`Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>\>

The ToolDefinition (ready for immediate use)

## Example

```typescript
// Without persistence (same as existing tool() helper)
const weatherTool = persistentTool({
  name: 'getWeather',
  description: 'Get weather',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => ({ temp: 22 }),
})

// With persistence to graph
const weatherTool = await persistentTool({
  name: 'getWeather',
  description: 'Get weather',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => ({ temp: 22 }),
  store: graphStore,
})
```
