[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ConversationMemoryConfig

# Interface: ConversationMemoryConfig

Defined in: [agents/memory.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L51)

Memory configuration for conversation context management

## Properties

### conversationId?

> `optional` **conversationId**: `string`

Defined in: [agents/memory.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L63)

Custom ID for the conversation

***

### maxMessages?

> `optional` **maxMessages**: `number`

Defined in: [agents/memory.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L53)

Maximum number of messages to keep in context

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [agents/memory.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L55)

Maximum total tokens in context window

***

### preserveSystemMessages?

> `optional` **preserveSystemMessages**: `boolean`

Defined in: [agents/memory.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L61)

Whether to preserve system messages during truncation

***

### summarizeThreshold?

> `optional` **summarizeThreshold**: `number`

Defined in: [agents/memory.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L59)

Token threshold that triggers summarization

***

### windowStrategy?

> `optional` **windowStrategy**: `"fifo"` \| `"summarize"`

Defined in: [agents/memory.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L57)

Strategy for truncating old messages
