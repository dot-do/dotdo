[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolCacheConfig

# Interface: ToolCacheConfig

Defined in: [agents/tool-cache.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L82)

Cache configuration options

## Properties

### defaultTTL?

> `optional` **defaultTTL**: `number`

Defined in: [agents/tool-cache.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L86)

Default TTL in milliseconds (default: 300000 = 5 minutes)

***

### maxSize?

> `optional` **maxSize**: `number`

Defined in: [agents/tool-cache.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L84)

Maximum number of entries (default: 500)

***

### storage?

> `optional` **storage**: [`CacheStorage`](CacheStorage.md)

Defined in: [agents/tool-cache.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L90)

Optional custom storage backend

***

### trackStats?

> `optional` **trackStats**: `boolean`

Defined in: [agents/tool-cache.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L88)

Whether to track statistics (default: true)
