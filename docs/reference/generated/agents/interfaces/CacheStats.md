[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CacheStats

# Interface: CacheStats

Defined in: [agents/tool-cache.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L108)

Cache statistics

## Properties

### bytesUsed

> **bytesUsed**: `number`

Defined in: [agents/tool-cache.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L118)

Bytes used (estimated)

***

### byTool

> **byTool**: `Record`\<`string`, \{ `entries`: `number`; `hits`: `number`; \}\>

Defined in: [agents/tool-cache.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L120)

Entries by tool

***

### hitRate

> **hitRate**: `number`

Defined in: [agents/tool-cache.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L116)

Hit rate (0-1)

***

### hits

> **hits**: `number`

Defined in: [agents/tool-cache.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L110)

Total cache hits

***

### misses

> **misses**: `number`

Defined in: [agents/tool-cache.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L112)

Total cache misses

***

### size

> **size**: `number`

Defined in: [agents/tool-cache.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L114)

Current number of entries
