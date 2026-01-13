[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createToolCache

# Function: createToolCache()

> **createToolCache**(`config`): [`ToolResultCache`](../classes/ToolResultCache.md)

Defined in: [agents/tool-cache.ts:473](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L473)

Create a tool result cache instance

## Parameters

### config

[`ToolCacheConfig`](../interfaces/ToolCacheConfig.md) = `{}`

## Returns

[`ToolResultCache`](../classes/ToolResultCache.md)

## Example

```ts
const cache = createToolCache({
  maxSize: 1000,
  defaultTTL: 600000, // 10 minutes
})

cache.registerTools([lookupTool, searchTool])
```
