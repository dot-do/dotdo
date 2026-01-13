[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CacheEntry

# Interface: CacheEntry\<T\>

Defined in: [agents/tool-cache.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L66)

Cache entry with metadata

## Type Parameters

### T

`T` = `unknown`

## Properties

### createdAt

> **createdAt**: `number`

Defined in: [agents/tool-cache.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L70)

When the entry was created

***

### hits

> **hits**: `number`

Defined in: [agents/tool-cache.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L74)

Number of cache hits

***

### result

> **result**: `T`

Defined in: [agents/tool-cache.ts:68](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L68)

Cached result

***

### toolName

> **toolName**: `string`

Defined in: [agents/tool-cache.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L76)

Tool name

***

### ttl

> **ttl**: `number`

Defined in: [agents/tool-cache.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L72)

Time-to-live in milliseconds
