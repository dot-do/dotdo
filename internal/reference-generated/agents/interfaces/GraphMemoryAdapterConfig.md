[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / GraphMemoryAdapterConfig

# Interface: GraphMemoryAdapterConfig

Defined in: [agents/unified-memory.ts:211](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L211)

Configuration for GraphMemoryAdapter

## Properties

### agentId

> **agentId**: `string`

Defined in: [agents/unified-memory.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L215)

Agent ID for scoping memories

***

### embedder()?

> `optional` **embedder**: (`text`) => `Promise`\<`number`[]\>

Defined in: [agents/unified-memory.ts:221](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L221)

Embedding function for semantic search

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`number`[]\>

***

### maxMessages?

> `optional` **maxMessages**: `number`

Defined in: [agents/unified-memory.ts:219](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L219)

Maximum messages to keep in memory

***

### sessionId?

> `optional` **sessionId**: `string`

Defined in: [agents/unified-memory.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L217)

Session/conversation ID

***

### store

> **store**: `GraphStore`

Defined in: [agents/unified-memory.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L213)

The graph store to use
