[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createConversationMemory

# ~~Function: createConversationMemory()~~

> **createConversationMemory**(`config?`): [`ConversationMemory`](../interfaces/ConversationMemory.md)

Defined in: [agents/memory.ts:505](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L505)

Create a conversation memory instance

## Parameters

### config?

[`ConversationMemoryConfig`](../interfaces/ConversationMemoryConfig.md)

## Returns

[`ConversationMemory`](../interfaces/ConversationMemory.md)

## Deprecated

Use `createInMemoryAgentMemory` with `toConversationMemory` instead:
```ts
import { createInMemoryAgentMemory, toConversationMemory } from './agents'
const memory = createInMemoryAgentMemory()
const conversationMemory = toConversationMemory(memory)
```

## Example

```ts
// Basic FIFO memory
const memory = createConversationMemory({
  maxMessages: 50,
  maxTokens: 8000,
})

// Summarization-based memory
const memory = createConversationMemory({
  windowStrategy: 'summarize',
  summarizeThreshold: 4000,
  maxTokens: 8000,
})
```
