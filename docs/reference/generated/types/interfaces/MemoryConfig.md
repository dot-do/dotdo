[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / MemoryConfig

# Interface: MemoryConfig

Defined in: [types/AIFunction.ts:287](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L287)

Memory configuration for agentic functions

## Properties

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [types/AIFunction.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L291)

Maximum tokens in context

***

### maxTurns?

> `optional` **maxTurns**: `number`

Defined in: [types/AIFunction.ts:289](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L289)

Maximum conversation turns to keep

***

### store?

> `optional` **store**: `"local"` \| `"redis"` \| `"durable-object"`

Defined in: [types/AIFunction.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L295)

External memory store

***

### summarization?

> `optional` **summarization**: `"none"` \| `"rolling"` \| `"hierarchical"`

Defined in: [types/AIFunction.ts:293](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L293)

Summarization strategy for long contexts
