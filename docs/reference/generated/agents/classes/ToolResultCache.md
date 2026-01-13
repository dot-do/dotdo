[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolResultCache

# Class: ToolResultCache

Defined in: [agents/tool-cache.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L268)

Tool Result Cache

Caches deterministic tool results to reduce redundant executions.
Integrates with agent hooks for transparent caching.

## Constructors

### Constructor

> **new ToolResultCache**(`config`): `ToolResultCache`

Defined in: [agents/tool-cache.ts:277](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L277)

#### Parameters

##### config

[`ToolCacheConfig`](../interfaces/ToolCacheConfig.md) = `{}`

#### Returns

`ToolResultCache`

## Methods

### clear()

> **clear**(): `void`

Defined in: [agents/tool-cache.ts:407](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L407)

Clear all cache entries

#### Returns

`void`

***

### get()

> **get**(`toolCall`): [`ToolResult`](../interfaces/ToolResult.md) \| `undefined`

Defined in: [agents/tool-cache.ts:315](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L315)

Get cached result for a tool call

#### Parameters

##### toolCall

[`ToolCall`](../interfaces/ToolCall.md)

#### Returns

[`ToolResult`](../interfaces/ToolResult.md) \| `undefined`

***

### getStats()

> **getStats**(): [`CacheStats`](../interfaces/CacheStats.md)

Defined in: [agents/tool-cache.ts:416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L416)

Get cache statistics

#### Returns

[`CacheStats`](../interfaces/CacheStats.md)

***

### invalidate()

> **invalidate**(`toolCall`): `boolean`

Defined in: [agents/tool-cache.ts:396](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L396)

Invalidate a specific cache entry

#### Parameters

##### toolCall

[`ToolCall`](../interfaces/ToolCall.md)

#### Returns

`boolean`

***

### invalidateTool()

> **invalidateTool**(`toolName`): `number`

Defined in: [agents/tool-cache.ts:375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L375)

Invalidate cache entries for a specific tool

#### Parameters

##### toolName

`string`

#### Returns

`number`

***

### isCacheable()

> **isCacheable**(`toolName`): `boolean`

Defined in: [agents/tool-cache.ts:308](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L308)

Check if a tool is cacheable

#### Parameters

##### toolName

`string`

#### Returns

`boolean`

***

### registerTool()

> **registerTool**(`tool`): `void`

Defined in: [agents/tool-cache.ts:290](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L290)

Register a cacheable tool

#### Parameters

##### tool

[`CacheableToolDefinition`](../interfaces/CacheableToolDefinition.md)

#### Returns

`void`

***

### registerTools()

> **registerTools**(`tools`): `void`

Defined in: [agents/tool-cache.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L299)

Register multiple tools

#### Parameters

##### tools

[`CacheableToolDefinition`](../interfaces/CacheableToolDefinition.md)\<`unknown`, `unknown`\>[]

#### Returns

`void`

***

### set()

> **set**(`toolCall`, `result`): `void`

Defined in: [agents/tool-cache.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L351)

Store a tool result in the cache

#### Parameters

##### toolCall

[`ToolCall`](../interfaces/ToolCall.md)

##### result

[`ToolResult`](../interfaces/ToolResult.md)

#### Returns

`void`
