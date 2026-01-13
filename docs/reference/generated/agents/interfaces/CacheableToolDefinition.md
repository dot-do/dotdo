[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CacheableToolDefinition

# Interface: CacheableToolDefinition\<TInput, TOutput\>

Defined in: [agents/tool-cache.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L53)

Extended tool definition with caching options

## Extends

- [`ToolDefinition`](ToolDefinition.md)\<`TInput`, `TOutput`\>

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Properties

### cacheable?

> `optional` **cacheable**: `boolean`

Defined in: [agents/tool-cache.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L56)

Whether this tool's results can be cached

***

### cacheKeyFn()?

> `optional` **cacheKeyFn**: (`input`) => `string`

Defined in: [agents/tool-cache.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L60)

Custom cache key generator

#### Parameters

##### input

`TInput`

#### Returns

`string`

***

### cacheTTL?

> `optional` **cacheTTL**: `number`

Defined in: [agents/tool-cache.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L58)

Custom TTL for this tool's cache entries (ms)

***

### description

> **description**: `string`

Defined in: [agents/types.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L102)

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`description`](ToolDefinition.md#description)

***

### execute()

> **execute**: (`input`, `context`) => `Promise`\<`TOutput`\>

Defined in: [agents/types.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L105)

#### Parameters

##### input

`TInput`

##### context

[`ToolContext`](ToolContext.md)

#### Returns

`Promise`\<`TOutput`\>

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`execute`](ToolDefinition.md#execute)

***

### inputSchema

> **inputSchema**: [`Schema`](../type-aliases/Schema.md)\<`TInput`\>

Defined in: [agents/types.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L103)

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`inputSchema`](ToolDefinition.md#inputschema)

***

### interruptible?

> `optional` **interruptible**: `boolean`

Defined in: [agents/types.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L108)

For voice agents: can this tool be called while speaking?

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`interruptible`](ToolDefinition.md#interruptible)

***

### name

> **name**: `string`

Defined in: [agents/types.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L101)

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`name`](ToolDefinition.md#name)

***

### outputSchema?

> `optional` **outputSchema**: [`Schema`](../type-aliases/Schema.md)\<`TOutput`\>

Defined in: [agents/types.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L104)

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`outputSchema`](ToolDefinition.md#outputschema)

***

### permission?

> `optional` **permission**: `"auto"` \| `"confirm"` \| `"deny"`

Defined in: [agents/types.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L110)

Permission level required

#### Inherited from

[`ToolDefinition`](ToolDefinition.md).[`permission`](ToolDefinition.md#permission)
