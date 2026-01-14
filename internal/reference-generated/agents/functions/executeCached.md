[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / executeCached

# Function: executeCached()

> **executeCached**\<`TInput`, `TOutput`\>(`cache`, `tool`, `toolCall`, `context`): `Promise`\<[`ToolResult`](../interfaces/ToolResult.md)\>

Defined in: [agents/tool-cache.ts:659](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L659)

Execute a tool with caching

Standalone function for executing a single tool with cache support.
Useful for manual tool execution outside of agent loops.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### cache

[`ToolResultCache`](../classes/ToolResultCache.md)

### tool

[`CacheableToolDefinition`](../interfaces/CacheableToolDefinition.md)\<`TInput`, `TOutput`\>

### toolCall

[`ToolCall`](../interfaces/ToolCall.md)

### context

#### abortSignal?

`AbortSignal`

#### agentId

`string`

## Returns

`Promise`\<[`ToolResult`](../interfaces/ToolResult.md)\>

## Example

```ts
const cache = createToolCache()
cache.registerTool(lookupTool)

const result = await executeCached(cache, lookupTool, {
  id: 'call_123',
  name: 'lookup',
  arguments: { id: 'user-1' },
}, context)
```
