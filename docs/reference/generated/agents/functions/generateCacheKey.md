[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / generateCacheKey

# Function: generateCacheKey()

> **generateCacheKey**(`toolName`, `args`): `string`

Defined in: [agents/tool-cache.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-cache.ts#L133)

Generate a stable cache key from tool name and arguments

Uses JSON serialization with sorted keys for deterministic output.
Handles circular references and non-serializable values gracefully.

## Parameters

### toolName

`string`

### args

`Record`\<`string`, `unknown`\>

## Returns

`string`
