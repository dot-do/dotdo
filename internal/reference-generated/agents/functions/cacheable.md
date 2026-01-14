[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / cacheable

# Function: cacheable()

> **cacheable**\<`TInput`, `TOutput`\>(`tool`, `options`): [`CacheableToolDefinition`](../interfaces/CacheableToolDefinition.md)\<`TInput`, `TOutput`\>

Defined in: [agents/tool-cache.ts:622](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L622)

Create a cacheable version of an existing tool

Wraps a tool definition to mark it as cacheable with optional custom settings.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### tool

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`TInput`, `TOutput`\>

### options

#### keyFn?

(`input`) => `string`

#### ttl?

`number`

## Returns

[`CacheableToolDefinition`](../interfaces/CacheableToolDefinition.md)\<`TInput`, `TOutput`\>

## Example

```ts
const searchTool = tool({
  name: 'search',
  description: 'Search documents',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => searchDocs(query),
})

const cacheableSearch = cacheable(searchTool, {
  ttl: 600000, // 10 minutes
})
```
