[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / withCaching

# Function: withCaching()

> **withCaching**(`cache`, `existingHooks`): [`AgentHooks`](../interfaces/AgentHooks.md)

Defined in: [agents/tool-cache.ts:561](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L561)

Wrap existing hooks with caching support

Combines existing hooks with caching hooks, preserving both behaviors.

## Parameters

### cache

[`ToolResultCache`](../classes/ToolResultCache.md)

### existingHooks

`Partial`\<[`AgentHooks`](../interfaces/AgentHooks.md)\> = `{}`

## Returns

[`AgentHooks`](../interfaces/AgentHooks.md)

## Example

```ts
const cache = createToolCache()
cache.registerTools(tools)

const existingHooks = {
  onPreToolUse: async (call) => {
    console.log('Tool called:', call.name)
    return { action: 'allow' }
  }
}

const hooks = withCaching(cache, existingHooks)
```
