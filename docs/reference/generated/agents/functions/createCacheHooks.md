[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createCacheHooks

# Function: createCacheHooks()

> **createCacheHooks**(`cache`): `Pick`\<[`AgentHooks`](../interfaces/AgentHooks.md), `"onPreToolUse"` \| `"onPostToolUse"`\> & `object`

Defined in: [agents/tool-cache.ts:501](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L501)

Create agent hooks for tool result caching

Returns hooks that integrate with the agent's onPreToolUse and onPostToolUse.
When a cached result exists, the tool execution is skipped and the cached
result is returned directly.

## Parameters

### cache

[`ToolResultCache`](../classes/ToolResultCache.md)

## Returns

## Example

```ts
const cache = createToolCache()
cache.registerTools(tools)

const hooks = createCacheHooks(cache)

const agent = provider.createAgent({
  tools,
  hooks,
})
```
