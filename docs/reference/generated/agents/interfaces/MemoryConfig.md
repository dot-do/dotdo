[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MemoryConfig

# Interface: MemoryConfig

Defined in: [agents/types.ts:307](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L307)

## Properties

### connection?

> `optional` **connection**: `unknown`

Defined in: [agents/types.ts:311](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L311)

For persistent: connection config

***

### embedModel?

> `optional` **embedModel**: `string`

Defined in: [agents/types.ts:313](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L313)

For vector: embedding model

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [agents/types.ts:315](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L315)

Max context window

***

### type

> **type**: `"ephemeral"` \| `"persistent"` \| `"vector"`

Defined in: [agents/types.ts:309](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L309)

Memory store type
